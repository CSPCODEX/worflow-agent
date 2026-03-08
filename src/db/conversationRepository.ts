import { randomUUID } from 'node:crypto';
import { getDatabase } from './database';

export interface ConversationRow {
  id: string;
  agent_id: string;
  title: string;
  created_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface ConversationRecord {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
}

export const conversationRepository = {
  create(params: { agentId: string; title?: string }): ConversationRecord {
    const db = getDatabase();
    const id = randomUUID();
    const now = new Date().toISOString();
    const title = params.title ?? 'Nueva conversacion';

    db.run(
      'INSERT INTO conversations (id, agent_id, title, created_at) VALUES (?, ?, ?, ?)',
      [id, params.agentId, title, now]
    );

    return { id, agentId: params.agentId, title, createdAt: now };
  },

  findByAgent(agentId: string): ConversationRecord[] {
    const db = getDatabase();
    const rows = db.query<ConversationRow, [string]>(
      'SELECT * FROM conversations WHERE agent_id = ? ORDER BY created_at DESC'
    ).all([agentId]);

    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      title: r.title,
      createdAt: r.created_at,
    }));
  },

  /** Idempotent — returns success:true even if id not found. */
  delete(id: string): void {
    const db = getDatabase();
    db.run('DELETE FROM conversations WHERE id = ?', [id]);
  },
};

export const messageRepository = {
  save(params: { conversationId: string; role: string; content: string }): MessageRecord {
    const db = getDatabase();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.run(
      'INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, params.conversationId, params.role, params.content, now]
    );

    return { id, conversationId: params.conversationId, role: params.role, content: params.content, createdAt: now };
  },

  findByConversation(conversationId: string): MessageRecord[] {
    const db = getDatabase();
    const rows = db.query<MessageRow, [string]>(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all([conversationId]);

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
    }));
  },
};
