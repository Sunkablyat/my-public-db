'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function Page() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  async function loadMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false });
    setMessages(data || []);
  }

  async function addMessage(e) {
    e.preventDefault();
    if (!text.trim()) return;
    await supabase.from('messages').insert([{ content: text.trim() }]);
    setText('');
    loadMessages();
  }

  useEffect(() => {
    loadMessages();
  }, []);

  return (
    <main style={{ maxWidth: 600, margin: '40px auto', padding: 16 }}>
      <h1>Public Messages</h1>

      <form onSubmit={addMessage} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit">Add</button>
      </form>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {messages.map((m) => (
          <li key={m.id} style={{ padding: '8px 0', borderBottom: '1px solid #ddd' }}>
            <div>{m.content}</div>
            <small>{new Date(m.created_at).toLocaleString()}</small>
          </li>
        ))}
      </ul>
    </main>
  );
}
