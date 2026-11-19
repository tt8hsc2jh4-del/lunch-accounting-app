import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const configuredPassword = process.env.EVENT_DELETE_PASSWORD;
    if (!configuredPassword) return NextResponse.json({ error: 'パスワード設定を確認できません。' }, { status: 503 });
    const body = await request.json();
    const suppliedPassword = typeof body.password === 'string' ? body.password : '';
    const supplied = Buffer.from(suppliedPassword);
    const expected = Buffer.from(configuredPassword);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return NextResponse.json({ error: 'パスワードが正しくありません。' }, { status: 401 });
    }

    const eventId = typeof body.eventId === 'string' ? body.eventId : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId) || !name || name.length > 100) {
      return NextResponse.json({ error: 'イベント名または指定内容が正しくありません。' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return NextResponse.json({ error: 'データベースに接続できません。' }, { status: 503 });
    const db = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from('lunch_events').update({ name }).eq('id', eventId).select('id,name').single();
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: '同じ名前のイベントが既にあります。' }, { status: 409 });
      if (error.code === 'PGRST116') return NextResponse.json({ error: '対象イベントが見つかりません。' }, { status: 404 });
      throw error;
    }
    return NextResponse.json({ ok: true, event: data });
  } catch (error) {
    console.error('Event rename failed:', error);
    return NextResponse.json({ error: 'イベント名を変更できませんでした。' }, { status: 500 });
  }
}
