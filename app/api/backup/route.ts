import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const configuredPassword = process.env.EVENT_DELETE_PASSWORD;
    const rpcSecret = process.env.BACKUP_RPC_SECRET;
    if (!configuredPassword || !rpcSecret) {
      return NextResponse.json({ error: 'バックアップの認証設定を確認できません。' }, { status: 503 });
    }

    const body = await request.json();
    const suppliedPassword = typeof body.password === 'string' ? body.password : '';
    const supplied = Buffer.from(suppliedPassword);
    const expected = Buffer.from(configuredPassword);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return NextResponse.json({ error: 'パスワードが正しくありません。' }, { status: 401 });
    }

    const action = body.action;
    if (action !== 'save' && action !== 'restore') {
      return NextResponse.json({ error: '操作内容が正しくありません。' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return NextResponse.json({ error: 'データベースに接続できません。' }, { status: 503 });

    const db = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc('manage_lunch_backup', {
      p_action: action,
      p_secret: rpcSecret
    });
    if (error) {
      console.error('Backup operation failed:', error);
      const message = action === 'restore' && error.message?.includes('No backup exists')
        ? '保存済みのバックアップがありません。先に「保存」を実行してください。'
        : 'バックアップ処理に失敗しました。データベースの状態を確認してください。';
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, result: data });
  } catch (error) {
    console.error('Backup API failed:', error);
    return NextResponse.json({ error: 'バックアップ処理に失敗しました。' }, { status: 500 });
  }
}
