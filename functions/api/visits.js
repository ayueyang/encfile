export async function onRequest(context) {
    const { env, request } = context;

    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers });
    }

    try {
        // 获取客户端信息
        const cf = request.cf || {};
        const clientIP = cf.ip || 'unknown';
        const userAgent = request.headers.get('user-agent') || 'unknown';
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // 每 IP 每天最多 10 次
        const MAX_PER_IP_PER_DAY = 10;

        // 优化：用一条 SQL 同时查询今天该 IP 次数和总次数
        const stats = await env.visits_db.prepare(
            `SELECT
                (SELECT COUNT(*) FROM visits WHERE ip = ? AND date(created_at) = ?) as ip_today,
                (SELECT COUNT(*) FROM visits) as total`
        ).bind(clientIP, today).first();

        const ipCount = stats ? stats.ip_today : 0;
        const total = stats ? stats.total : 0;

        let counted = false;
        let count = total;

        // 只有未超限时才写入
        if (ipCount < MAX_PER_IP_PER_DAY) {
            // 插入访问记录
            await env.visits_db.prepare(
                'INSERT INTO visits (ip, user_agent) VALUES (?, ?)'
            ).bind(clientIP, userAgent).run();
            counted = true;
            count = total + 1;
        }

        return new Response(JSON.stringify({
            count: count,
            counted: counted,
            ip_count_today: ipCount + (counted ? 1 : 0),
            limit: MAX_PER_IP_PER_DAY
        }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ count: 0, error: e.message }), { headers });
    }
}
