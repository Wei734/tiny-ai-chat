// server/routes/threads.js
const { readThreads, writeThreads } = require('../utils/storage');

module.exports = function(app) {
    // ========== 线程管理 API ==========
    // 1. 获取对话列表（只返回摘要，不包含具体消息）
    app.get('/api/threads', (req, res) => {
    try {
        const threads = readThreads();
        // 摘要信息：id, title, updatedAt, messageCount 等
        const list = threads.map(t => ({
        id: t.id,
        title: t.title,
        messageCount: t.messages?.length || 0,
        updatedAt: t.updatedAt
        }));
        // 按更新时间倒序
        list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        res.json(list);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '读取线程列表失败' });
    }
    });

    // 2. 获取某个对话的全部消息
    app.get('/api/threads/:id', (req, res) => {
    try {
        const threads = readThreads();
        const thread = threads.find(t => t.id == req.params.id);
        if (!thread) {
        return res.status(404).json({ error: '对话不存在' });
        }
        res.json(thread);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '读取对话失败' });
    }
    });

    // 4. 删除某个对话
    app.delete('/api/threads/:id', (req, res) => {
    try {
        const threads = readThreads();
        const filtered = threads.filter(t => t.id != req.params.id);
        if (filtered.length === threads.length) {
        return res.status(404).json({ error: '对话不存在' });
        }
        writeThreads(filtered);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '删除失败' });
    }
    });
}