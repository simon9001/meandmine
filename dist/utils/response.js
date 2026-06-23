export function ok(c, data, status = 200) {
    return c.json({ success: true, data }, status);
}
export function paginated(c, data, meta) {
    return c.json({
        success: true,
        data,
        meta: { ...meta, totalPages: Math.ceil(meta.total / meta.limit) },
    });
}
export function noContent(c) {
    return c.body(null, 204);
}
