import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const configuredPassword = process.env.EVENT_DELETE_PASSWORD;
    if (!configuredPassword) {
      return NextResponse.json({ error: '削除用パスワードが設定されていません。' }, { status: 503 });
    }

    const body = await request.json();
    const suppliedPassword = typeof body.password === 'string' ? body.password : '';
    const supplied = Buffer.from(suppliedPassword);
    const expected = Buffer.from(configuredPassword);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return NextResponse.json({ error: 'パスワードが正しくありません。' }, { status: 401 });
    }

    const eventId = typeof body.eventId === 'string' ? body.eventId : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      return NextResponse.json({ error: 'イベントの指定が正しくありません。' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return NextResponse.json({ error: 'データベースに接続できません。' }, { status: 503 });

    const db = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: events, error: listError } = await db.from('lunch_events').select('id').order('created_at', { ascending: true });
    if (listError) throw listError;
    if (!events?.some(event => event.id === eventId)) {
      return NextResponse.json({ error: '対象イベントが見つかりません。' }, { status: 404 });
    }
    if ((events?.length ?? 0) <= 1) {
      return NextResponse.json({ error: '最後のイベントは削除できません。' }, { status: 409 });
    }

    const steps = [
      () => db.from('lunch_orders').delete().eq('event_id', eventId),
      () => db.from('lunch_settlements').delete().eq('event_id', eventId),
      () => db.from('lunch_menus').delete().eq('event_id', eventId),
      () => db.from('lunch_participants').delete().eq('event_id', eventId),
      () => db.from('lunch_events').delete().eq('id', eventId)
    ];
    for (const step of steps) {
      const { error } = await step();
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Event deletion failed:', error);
    return NextResponse.json({ error: 'イベントを削除できませんでした。データは確認してから再度お試しください。' }, { status: 500 });
  }
}
