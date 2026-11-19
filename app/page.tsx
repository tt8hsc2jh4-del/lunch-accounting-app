'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type EventItem = { id: string; name: string };
type Person = { id: number; name: string };
type DirectoryMember = { id: number; name: string };
type Menu = { id: number; name: string; price: number; hidden: boolean | null; lunch_day: number };
type Order = { id: number; participant_id: number; lunch_day: number; menu_id: number; amount: number; paid: boolean; locked_amount: number | null; cash: number | null };
type Settlement = { participant_id: number; lunch_day: number; paid: boolean; cash: number | null };
type Tab = 'account' | 'members' | 'menus';
type Confirm = { kind: 'order' | 'person' | 'menu' | 'directory'; id: number } | null;
const DEFAULT_MEMBER_ORDER = ['三木 和','中山 貴志','牛山 和徳','牛山 京子','瀬下 正人','丹 寛','奥西 英夫','小出 秀樹','舩津 将行','金子 崇史','清水 貴之','玉田 徹','草浦 愼','大坂 宗仁','磯辺 孝明','濟木啓','池田恭也','佐藤大雅','佐藤勉','若松宏','井口昌摩'];
const yen = (value: number) => new Intl.NumberFormat('ja-JP').format(value) + '円';

export default function Home() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('20261120-0000-4000-8000-000000000001');
  const [eventDropdownOpen, setEventDropdownOpen] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventNameDraft, setEventNameDraft] = useState('');
  const [eventDeletePassword, setEventDeletePassword] = useState('');
  const [eventDeleteBusy, setEventDeleteBusy] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [directory, setDirectory] = useState<DirectoryMember[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [cashDraft, setCashDraft] = useState<Record<string, string>>({});
  const [day, setDay] = useState(1);
  const [menuDay, setMenuDay] = useState(1);
  const [tab, setTab] = useState<Tab>('account');
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alert, setAlert] = useState('');
  const [newOrder, setNewOrder] = useState<Record<number, string>>({});
  const [newPerson, setNewPerson] = useState('');
  const [memberDropdownOpen, setMemberDropdownOpen] = useState(false);
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuPrice, setNewMenuPrice] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [editingPerson, setEditingPerson] = useState<number | null>(null);
  const [personDraft, setPersonDraft] = useState('');
  const [editingMenu, setEditingMenu] = useState<number | null>(null);
  const [menuDraft, setMenuDraft] = useState({ name: '', price: '' });
  const [addingMenuOrder, setAddingMenuOrder] = useState<number | null>(null);
  const [selectedMenuOrderPeople, setSelectedMenuOrderPeople] = useState<number[]>([]);

  const load = useCallback(async () => {
    if (!supabase) { setError('Supabaseの接続設定がありません。'); setLoading(false); return; }
    const [ev, p, m, o, st, dir] = await Promise.all([
      supabase.from('lunch_events').select('id,name').order('created_at', { ascending: false }),
      supabase.from('lunch_participants').select('id,name').eq('event_id', eventId).order('id'),
      supabase.from('lunch_menus').select('id,name,price,hidden,lunch_day').eq('event_id', eventId).order('id'),
      supabase.from('lunch_orders').select('id,participant_id,lunch_day,menu_id,amount,paid,locked_amount,cash').eq('event_id', eventId).order('id'),
      supabase.from('lunch_settlements').select('participant_id,lunch_day,paid,cash').eq('event_id', eventId),
      supabase.from('lunch_member_directory').select('id,name').order('name')
    ]);
    const issue = ev.error || p.error || m.error || o.error || st.error || dir.error;
    if (issue) setError(issue.message);
    else {
      setEvents(ev.data ?? []); setPeople(p.data ?? []); setDirectory(dir.data ?? []); setMenus(m.data ?? []); setOrders(o.data ?? []); setSettlements(st.data ?? []);
      setCashDraft(() => { const next: Record<string, string> = {}; for (const item of (st.data ?? []) as Settlement[]) next[`${item.participant_id}-${item.lunch_day}`] = item.cash == null ? '' : String(item.cash); return next; });
      setError('');
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);
  async function addEvent() {
    const name = newEventName.trim();
    if (!supabase || !name) return;
    const existing = events.find(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) { setEventId(existing.id); setNewEventName(''); setEventDropdownOpen(false); setAlert('同じ名前のイベントがあるため、既存イベントに切り替えました。'); return; }
    const { data, error: e } = await supabase.from('lunch_events').insert({ name }).select('id,name').single();
    if (e || !data) { setError(e?.message ?? 'イベントを作成できませんでした。'); return; }
    setEvents(current => [data as EventItem, ...current]);
    setNewEventName('');
    setDay(1); setMenuDay(1); setFilter('all'); setConfirm(null);
    setLoading(true);
    setEventId(data.id);
    setEventDropdownOpen(false);
    setAlert('新しいイベントを作成しました。');
  }

  async function deleteEvent(item: EventItem) {
    if (!eventDeletePassword || eventDeleteBusy || events.length <= 1) return;
    setEventDeleteBusy(true);
    try {
      const response = await fetch('/api/events/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: item.id, password: eventDeletePassword })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || 'イベントを削除できませんでした。');
        return;
      }
      const remaining = events.filter(event => event.id !== item.id);
      setEvents(remaining);
      if (eventId === item.id) {
        setLoading(true);
        setEventId(remaining[0].id);
        setDay(1); setMenuDay(1); setFilter('all'); setConfirm(null);
      }
      setDeletingEventId(null);
      setEventDeletePassword('');
      setAlert('イベントと関連データを削除しました。');
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setEventDeleteBusy(false);
    }
  }

  async function saveEventName(item: EventItem) {
    const name = eventNameDraft.trim();
    if (!name || !eventDeletePassword || eventDeleteBusy) return;
    setEventDeleteBusy(true);
    try {
      const response = await fetch('/api/events/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: item.id, name, password: eventDeletePassword })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || 'イベント名を変更できませんでした。');
        return;
      }
      setEvents(current => current.map(event => event.id === item.id ? { ...event, name: result.event.name } : event));
      setEditingEventId(null);
      setEventNameDraft('');
      setEventDeletePassword('');
      setAlert('イベント名を変更しました。');
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setEventDeleteBusy(false);
    }
  }

  async function runBackup(action: 'save' | 'restore') {
    if (!backupPassword || backupBusy) return;
    if (action === 'restore' && !window.confirm('最後に保存した内容で、現在のイベント一覧・全イベントの入力内容・登録名簿を置き換えます。よろしいですか？')) return;
    setBackupBusy(true);
    try {
      const response = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, password: backupPassword })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || 'バックアップ処理に失敗しました。');
        return;
      }
      setBackupPassword('');
      if (action === 'save') {
        setAlert('全イベントと登録名簿を保存しました。');
      } else {
        setBackupOpen(false);
        setDay(1); setMenuDay(1); setFilter('all'); setConfirm(null);
        if (!supabase) return;
        const { data: restoredEvents, error: eventsError } = await supabase.from('lunch_events').select('id,name').order('created_at', { ascending: false });
        if (eventsError) {
          setError('復元は完了しましたが、画面の再読み込みに失敗しました。ページを再読み込みしてください。');
          return;
        }
        setEvents(restoredEvents ?? []);
        if (restoredEvents?.length && !restoredEvents.some(item => item.id === eventId)) {
          setLoading(true);
          setEventId(restoredEvents[0].id);
        } else {
          await load();
        }
        setAlert('保存時点のイベント・入力内容・登録名簿を復元しました。');
      }
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setBackupBusy(false);
    }
  }

  useEffect(() => {
    if (!alert) return;
    const timer = window.setTimeout(() => setAlert(''), 2000);
    return () => window.clearTimeout(timer);
  }, [alert]);
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const channel = client.channel('lunch-accounting-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lunch_events' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lunch_participants' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lunch_member_directory' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lunch_menus' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lunch_orders' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lunch_settlements' }, () => { void load(); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [load]);

  const orderedPeople = useMemo(() => [...people].sort((a, b) => {
    const ai = DEFAULT_MEMBER_ORDER.indexOf(a.name), bi = DEFAULT_MEMBER_ORDER.indexOf(b.name);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.id - b.id;
  }), [people]);

  const visibleMenus = useMemo(() => menus.filter(m => m.lunch_day === day && !m.hidden), [menus, day]);
  const menuVisibleMenus = useMemo(() => menus.filter(m => m.lunch_day === menuDay && !m.hidden), [menus, menuDay]);
  const dayOrders = useMemo(() => orders.filter(o => o.lunch_day === day), [orders, day]);
  const total = dayOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const orderingPeopleIds = new Set(dayOrders.map(o => o.participant_id));
  const peopleCount = orderingPeopleIds.size;
  const unpaidPeopleIds = [...orderingPeopleIds].filter(personId => !settlements.find(x => x.participant_id === personId && x.lunch_day === day)?.paid);
  const unpaidAmount = dayOrders.filter(order => unpaidPeopleIds.includes(order.participant_id)).reduce((sum, order) => sum + Number(order.amount || 0), 0);
  const getSettlement = (personId: number) => settlements.find(x => x.participant_id === personId && x.lunch_day === day);
  const filteredPeople = orderedPeople.filter(person => {
    const mine = dayOrders.filter(o => o.participant_id === person.id);
    const paid = !!getSettlement(person.id)?.paid;
    if (filter === 'unpaid') return mine.length > 0 && !paid;
    if (filter === 'paid') return mine.length > 0 && paid;
    return true;
  });

  async function addOrder(personId: number) {
    if (!supabase) return;
    const menu = visibleMenus.find(m => m.id === Number(newOrder[personId]));
    if (!menu) return;
    const { error: e } = await supabase.from('lunch_orders').insert({ event_id: eventId, participant_id: personId, lunch_day: day, menu_id: menu.id, amount: menu.price, paid: false });
    if (e) setError(e.message); else {
      await supabase.from('lunch_settlements').upsert({ event_id: eventId, participant_id: personId, lunch_day: day, paid: false }, { onConflict: 'participant_id,lunch_day,event_id' });
      setNewOrder(v => ({ ...v, [personId]: '' })); await load();
    }
  }
  async function deleteOrder(id: number) {
    if (!supabase) return;
    const { error: e } = await supabase.from('lunch_orders').delete().eq('id', id);
    if (e) setError(e.message); else { setConfirm(null); await load(); }
  }
  async function updateSettlement(personId: number, patch: Partial<Pick<Settlement, 'paid' | 'cash'>>) {
    if (!supabase) return;
    const current = getSettlement(personId);
    const { error: e } = await supabase.from('lunch_settlements').upsert({ event_id: eventId, participant_id: personId, lunch_day: day, paid: current?.paid ?? false, cash: current?.cash ?? null, ...patch }, { onConflict: 'participant_id,lunch_day,event_id' });
    if (e) setError(e.message); else await load();
  }
  async function saveCash(personId: number) {
    const key = `${personId}-${day}`;
    const raw = cashDraft[key] ?? '';
    if (raw.trim() === '') { await updateSettlement(personId, { cash: null }); return; }
    const amount = Number(raw);
    if (!Number.isInteger(amount) || amount < 0) { setError('預り金は0以上の整数で入力してください。'); return; }
    await updateSettlement(personId, { cash: amount });
  }
  async function addPerson() {
    const name = newPerson.trim();
    if (!supabase || !name) return;
    const { error: de } = await supabase.from('lunch_member_directory').upsert({ name }, { onConflict: 'name' });
    if (de) { setError(de.message); return; }
    if (people.some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setNewPerson(''); setAlert('このメンバーは既に今回の一覧に登録されています。'); await load(); return;
    }
    const { error: e } = await supabase.from('lunch_participants').insert({ event_id: eventId, name });
    if (e) setError(e.message); else { setNewPerson(''); setMemberDropdownOpen(false); await load(); }
  }
  async function activateDirectoryMember(member: DirectoryMember) {
    if (!supabase || people.some(p => p.name.toLocaleLowerCase() === member.name.toLocaleLowerCase())) return;
    const { error: e } = await supabase.from('lunch_participants').insert({ event_id: eventId, name: member.name });
    if (e) setError(e.message); else await load();
  }
  async function deleteDirectoryMember(id: number) {
    if (!supabase) return;
    const member = directory.find(item => item.id === id);
    const active = member && people.find(person => person.name.toLocaleLowerCase() === member.name.toLocaleLowerCase());
    if (active) {
      const { error: oe } = await supabase.from('lunch_orders').delete().eq('participant_id', active.id).eq('event_id', eventId);
      if (oe) { setError(oe.message); return; }
      const { error: se } = await supabase.from('lunch_settlements').delete().eq('participant_id', active.id).eq('event_id', eventId);
      if (se) { setError(se.message); return; }
      const { error: pe } = await supabase.from('lunch_participants').delete().eq('id', active.id).eq('event_id', eventId);
      if (pe) { setError(pe.message); return; }
    }
    const { error: e } = await supabase.from('lunch_member_directory').delete().eq('id', id);
    if (e) setError(e.message); else { setConfirm(null); await load(); }
  }
  async function savePerson(id: number) {
    if (!supabase || !personDraft.trim()) return;
    const current = people.find(p => p.id === id);
    const { error: e } = await supabase.from('lunch_participants').update({ name: personDraft.trim() }).eq('id', id).eq('event_id', eventId);
    if (e) { setError(e.message); return; }
    if (current && current.name !== personDraft.trim()) {
      const { error: de } = await supabase.from('lunch_member_directory').upsert({ name: personDraft.trim() }, { onConflict: 'name' });
      if (de) { setError(de.message); return; }
    }
    setEditingPerson(null); await load();
  }
  async function deletePerson(id: number) {
    if (!supabase) return;
    const { error: e } = await supabase.from('lunch_orders').delete().eq('participant_id', id).eq('event_id', eventId);
    if (e) { setError(e.message); return; }
    const { error: pe } = await supabase.from('lunch_participants').delete().eq('id', id).eq('event_id', eventId);
    if (pe) setError(pe.message); else { setConfirm(null); await load(); }
  }
  async function addMenu() {
    const name = newMenuName.trim(), price = Number(newMenuPrice);
    if (!supabase || !name || newMenuPrice.trim() === '' || !Number.isFinite(price) || price < 0) return;
    const { error: e } = await supabase.from('lunch_menus').insert({ event_id: eventId, name, price, lunch_day: menuDay, hidden: false });
    if (e) setAlert(e.code === '23505' ? 'このメニューは既に登録されています。' : 'メニューを追加できませんでした。入力内容をご確認ください。'); else { setNewMenuName(''); setNewMenuPrice(''); await load(); }
  }
  async function saveMenu(id: number) {
    const name = menuDraft.name.trim(), price = Number(menuDraft.price);
    if (!supabase || !name || menuDraft.price.trim() === '' || !Number.isFinite(price) || price < 0) return;
    const { error: e } = await supabase.from('lunch_menus').update({ name, price }).eq('id', id).eq('event_id', eventId);
    if (e) { setError(e.message); return; }
    const { error: oe } = await supabase.from('lunch_orders').update({ amount: price }).eq('menu_id', id).eq('lunch_day', menuDay).eq('event_id', eventId);
    if (oe) setError(oe.message); else { setEditingMenu(null); await load(); }
  }
  async function addMenuOrder(menu: Menu) {
    if (!supabase || selectedMenuOrderPeople.length === 0) return;
    const orderRows = selectedMenuOrderPeople.map(personId => ({
      event_id: eventId, participant_id: personId, lunch_day: menuDay, menu_id: menu.id, amount: menu.price, paid: false
    }));
    const { error: e } = await supabase.from('lunch_orders').insert(orderRows);
    if (e) { setError(e.message); return; }
    const settlementRows = selectedMenuOrderPeople.map(participant_id => ({
      event_id: eventId, participant_id, lunch_day: menuDay, paid: false
    }));
    const { error: se } = await supabase.from('lunch_settlements').upsert(settlementRows, { onConflict: 'participant_id,lunch_day,event_id', ignoreDuplicates: true });
    if (se) { setError(se.message); return; }
    setAddingMenuOrder(null);
    setSelectedMenuOrderPeople([]);
    await load();
  }
  async function deleteMenu(id: number) {
    if (!supabase) return;
    const { error: oe } = await supabase.from('lunch_orders').delete().eq('menu_id', id).eq('lunch_day', menuDay).eq('event_id', eventId);
    if (oe) { setError(oe.message); return; }
    const { error: me } = await supabase.from('lunch_menus').delete().eq('id', id).eq('event_id', eventId);
    if (me) setError(me.message); else { setConfirm(null); await load(); }
  }

  return <main className="shell">
    <header className="topbar">
      <div className="brand-event-row">
        <h1>会計アプリ</h1>
        <div className="event-switcher">
          <button type="button" className="event-switcher-trigger" aria-expanded={eventDropdownOpen} onClick={() => setEventDropdownOpen(v => !v)}>
            <span>{events.find(item => item.id === eventId)?.name ?? 'イベントを選択'}</span><span className="event-chevron">▾</span>
          </button>
          {eventDropdownOpen && <div className="event-switcher-panel">
            <label>イベントを切り替え</label>
            <div className="event-list">
              {events.map(item => <div className={`event-list-item ${item.id === eventId ? 'current' : ''}`} key={item.id}>
                <button type="button" className="event-name-button" onClick={() => { setLoading(true); setEventId(item.id); setConfirm(null); setDeletingEventId(null); setEditingEventId(null); setEventDeletePassword(''); setEventDropdownOpen(false); }}>{item.name}{item.id === eventId ? '（使用中）' : ''}</button>
                <div className="event-row-actions">
                  <button type="button" className="event-edit-button" onClick={() => { setEditingEventId(current => current === item.id ? null : item.id); setDeletingEventId(null); setEventNameDraft(item.name); setEventDeletePassword(''); }}>編集</button>
                  <button type="button" className="text-danger event-delete-button" disabled={events.length <= 1} onClick={() => { setDeletingEventId(current => current === item.id ? null : item.id); setEditingEventId(null); setEventDeletePassword(''); }}>削除</button>
                </div>
                {editingEventId === item.id && <div className="event-delete-confirm event-rename-confirm">
                  <strong>イベント名を編集</strong>
                  <input type="text" value={eventNameDraft} maxLength={100} onChange={e => setEventNameDraft(e.target.value)} placeholder="イベント名" />
                  <input type="password" autoComplete="current-password" value={eventDeletePassword} onChange={e => setEventDeletePassword(e.target.value)} placeholder="共通パスワード" onKeyDown={e => { if (e.key === 'Enter') void saveEventName(item); }} />
                  <div><button type="button" className="primary-button" disabled={!eventNameDraft.trim() || !eventDeletePassword || eventDeleteBusy} onClick={() => void saveEventName(item)}>{eventDeleteBusy ? '変更中…' : '変更'}</button><button type="button" onClick={() => { setEditingEventId(null); setEventNameDraft(''); setEventDeletePassword(''); }}>キャンセル</button></div>
                </div>}
                {deletingEventId === item.id && <div className="event-delete-confirm">
                  <strong>「{item.name}」を削除しますか？</strong>
                  <span>このイベントのメンバー・メニュー・注文・会計データもすべて削除されます。登録名簿は残ります。</span>
                  <input type="password" autoComplete="current-password" value={eventDeletePassword} onChange={e => setEventDeletePassword(e.target.value)} placeholder="共通パスワード" onKeyDown={e => { if (e.key === 'Enter') void deleteEvent(item); }} />
                  <div><button type="button" className="danger-button" disabled={!eventDeletePassword || eventDeleteBusy || events.length <= 1} onClick={() => void deleteEvent(item)}>{eventDeleteBusy ? '削除中…' : '削除する'}</button><button type="button" onClick={() => { setDeletingEventId(null); setEventDeletePassword(''); }}>キャンセル</button></div>
                </div>}
              </div>)}
            </div>
            <div className="event-create-row">
              <input value={newEventName} onChange={e => setNewEventName(e.target.value)} placeholder="新しいイベント名を入力" onKeyDown={e => { if (e.key === 'Enter') void addEvent(); }} />
              <button type="button" className="primary-button" disabled={!newEventName.trim()} onClick={() => void addEvent()}>新規イベントを追加</button>
            </div>
          </div>}
        </div>
        <div className="backup-widget">
          <button type="button" className="backup-trigger" aria-expanded={backupOpen} onClick={() => setBackupOpen(value => !value)}>BACKUP</button>
          {backupOpen && <div className="backup-panel">
            <strong>バックアップ</strong>
            <p>イベント一覧・全イベントのメンバー／メニュー／注文／会計情報・登録名簿を一括保存します。</p>
            <label htmlFor="backup-password">共通パスワード</label>
            <input id="backup-password" type="password" autoComplete="current-password" value={backupPassword} onChange={event => setBackupPassword(event.target.value)} placeholder="パスワードを入力" onKeyDown={event => { if (event.key === 'Enter') void runBackup('save'); }} />
            <div className="backup-actions">
              <button type="button" className="primary-button" disabled={!backupPassword || backupBusy} onClick={() => void runBackup('save')}>{backupBusy ? '処理中…' : '保存'}</button>
              <button type="button" className="backup-restore-button" disabled={!backupPassword || backupBusy} onClick={() => void runBackup('restore')}>読出</button>
              <button type="button" className="backup-close-button" onClick={() => { setBackupOpen(false); setBackupPassword(''); }}>閉じる</button>
            </div>
            <small>読出を実行すると、現在のデータは最後の保存内容に置き換わります。</small>
          </div>}
        </div>
      </div>
    </header>
    <nav className="tabs"><button className={tab === 'account' ? 'selected' : ''} onClick={() => setTab('account')}>会計管理</button><button className={tab === 'members' ? 'selected' : ''} onClick={() => setTab('members')}>メンバー管理</button><button className={tab === 'menus' ? 'selected' : ''} onClick={() => setTab('menus')}>メニュー管理</button></nav>
    {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}>閉じる</button></div>}
    {alert && <div className="error-banner timed-alert" role="status"><span>{alert}</span></div>}
    {loading ? <div className="loading">読み込み中…</div> : <>
      {tab === 'account' && <section>
        <div className="section-heading block-heading tab-title-row"><h2>会計管理</h2><div className="day-switch"><button className={day === 1 ? 'active' : ''} onClick={() => { setDay(1); setConfirm(null); }}>1日目</button><button className={day === 2 ? 'active' : ''} onClick={() => { setDay(2); setConfirm(null); }}>2日目</button></div></div>
        <div className="summary-grid"><article><span>注文合計</span><strong>{yen(total)}</strong></article><article><span>注文人数</span><strong>{peopleCount}/{orderedPeople.length}<small>人</small></strong></article><article><span>注文数</span><strong>{dayOrders.length}<small>品</small></strong></article></div>
        <div className="section-heading account-filter-row"><div className="filters"><button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>全員</button><button className={filter === 'unpaid' ? 'on' : ''} onClick={() => setFilter('unpaid')}>未払い</button><button className={filter === 'paid' ? 'on' : ''} onClick={() => setFilter('paid')}>支払済</button></div><div className="unpaid-summary"><strong>未払い {unpaidPeopleIds.length}名</strong><strong>{yen(unpaidAmount)}</strong></div></div>
        <div className="people-grid">{filteredPeople.map(person => {
          const mine = dayOrders.filter(o => o.participant_id === person.id);
          const subtotal = mine.reduce((sum, o) => sum + Number(o.amount || 0), 0);
          return <article className="person-card" key={person.id}>
            <div className="person-heading"><h3>{person.name}</h3><b>{yen(subtotal)}</b></div>
            {mine.length === 0 ? <p className="muted">注文はありません</p> : <div className="order-list">{mine.map(order => {
              const menu = menus.find(m => m.id === order.menu_id);
              return <div className="order-item" key={order.id}>
                <div className="order-line"><span>{menu?.name ?? '削除済みメニュー'}</span><strong>{yen(order.amount)}</strong></div>
                <div className="order-controls"><span className="muted">注文内容</span><button className="text-danger" onClick={() => setConfirm({ kind: 'order', id: order.id })}>削除</button></div>
                {confirm?.kind === 'order' && confirm.id === order.id && <div className="inline-confirm">この注文を削除しますか？<div><button className="danger-button" onClick={() => void deleteOrder(order.id)}>削除する</button><button onClick={() => setConfirm(null)}>キャンセル</button></div></div>}
              </div>;
            })}</div>}
            {mine.length > 0 && <div className="settlement-panel">
              <div className="settlement-row"><label className="settlement-paid"><input type="checkbox" checked={!!getSettlement(person.id)?.paid} onChange={e => void updateSettlement(person.id, { paid: e.target.checked })} />支払済</label>
              <div className="cash-entry"><label htmlFor={`cash-${person.id}-${day}`}>預り金</label><div><input id={`cash-${person.id}-${day}`} type="number" min="0" step="1" inputMode="numeric" placeholder="金額を入力" value={cashDraft[`${person.id}-${day}`] ?? (getSettlement(person.id)?.cash == null ? '' : String(getSettlement(person.id)!.cash))} onChange={e => setCashDraft(v => ({ ...v, [`${person.id}-${day}`]: e.target.value }))} onBlur={() => void saveCash(person.id)} /><span>円</span></div></div></div>
              {getSettlement(person.id)?.cash != null && <p className={`cash-result ${Number(getSettlement(person.id)!.cash) >= subtotal ? 'change' : 'short'}`}>{Number(getSettlement(person.id)!.cash) >= subtotal ? `お釣り：${yen(Number(getSettlement(person.id)!.cash) - subtotal)}` : `不足金額：${yen(subtotal - Number(getSettlement(person.id)!.cash))}`}</p>}
            </div>}
            <div className="add-order"><select aria-label={person.name + 'の注文を追加'} value={newOrder[person.id] || ''} onChange={e => setNewOrder(v => ({ ...v, [person.id]: e.target.value }))}><option value="">注文を追加</option>{visibleMenus.map(menu => <option key={menu.id} value={menu.id}>{menu.name}（{yen(menu.price)}）</option>)}</select><button className="primary-button" disabled={!newOrder[person.id]} onClick={() => void addOrder(person.id)}>追加</button></div>
          </article>;
        })}</div>
      </section>}
      {tab === 'members' && <section>
        <div className="section-heading block-heading"><div><h2>メンバー管理</h2></div></div>
        <div className="member-picker">
          <div className="member-picker-add">
            <input value={newPerson} onChange={e => setNewPerson(e.target.value)} placeholder="新しいメンバー名を入力" onKeyDown={e => { if (e.key === 'Enter') void addPerson(); }} />
            <button className="primary-button" onClick={() => void addPerson()} disabled={!newPerson.trim()}>名簿に登録して今回に追加</button>
          </div>
          <button type="button" className="member-picker-trigger" aria-expanded={memberDropdownOpen} onClick={() => setMemberDropdownOpen(v => !v)}>
            <span>名簿から追加</span><span className="member-picker-count">登録名簿 {directory.length}名</span><span className="member-picker-chevron">{memberDropdownOpen ? '▲' : '▼'}</span>
          </button>
          {memberDropdownOpen && <div className="member-picker-panel">
            <div className="member-picker-list">{directory.map(member => {
              const active = people.some(p => p.name.toLocaleLowerCase() === member.name.toLocaleLowerCase());
              return <div className="member-picker-item" key={member.id}>
                <span>{member.name}</span>
                <div className="member-picker-actions">
                  {confirm?.kind === 'directory' && confirm.id === member.id
                    ? <div className="member-picker-confirm"><span>登録名簿から削除しますか？</span><button type="button" className="danger-button" onClick={() => void deleteDirectoryMember(member.id)}>削除する</button><button type="button" onClick={() => setConfirm(null)}>キャンセル</button></div>
                    : <><button type="button" className="primary-button" disabled={active} onClick={() => void activateDirectoryMember(member)}>{active ? '今回追加済み' : '今回に追加'}</button><button type="button" className="text-danger" onClick={() => setConfirm({ kind: 'directory', id: member.id })}>名簿から削除</button></>}
                </div>
              </div>;
            })}</div>
          </div>}
        </div>
        <div className="member-list">{orderedPeople.map(person => <article className="member-card" key={person.id}>
          <div className="member-heading">{editingPerson === person.id ? <div className="edit-row"><input value={personDraft} onChange={e => setPersonDraft(e.target.value)} /><button onClick={() => void savePerson(person.id)}>変更</button><button onClick={() => setEditingPerson(null)}>キャンセル</button></div> : <><h3>{person.name}</h3><div><button onClick={() => { setEditingPerson(person.id); setPersonDraft(person.name); }}>編集</button><button className="text-danger" onClick={() => setConfirm({ kind: 'person', id: person.id })}>削除</button></div></>}</div>
          {confirm?.kind === 'person' && confirm.id === person.id && <div className="inline-confirm">このメンバーと今回の注文を削除しますか？<div><button className="danger-button" onClick={() => void deletePerson(person.id)}>削除する</button><button onClick={() => setConfirm(null)}>キャンセル</button></div></div>}
          <div className="member-days">{[1, 2].map(d => { const os = orders.filter(o => o.participant_id === person.id && o.lunch_day === d); return <div key={d}><b>{d}日目</b><span>{os.length}品</span><span className="member-menu-names">{os.map(o => menus.find(m => m.id === o.menu_id)?.name ?? '削除済み').join('、') || '注文なし'}</span><strong>{yen(os.reduce((sum, o) => sum + Number(o.amount || 0), 0))}</strong></div>; })}</div>
        </article>)}</div>
      </section>}
      {tab === 'menus' && <section>
        <div className="section-heading block-heading tab-title-row"><h2>メニュー管理</h2><div className="day-switch"><button className={menuDay === 1 ? 'active' : ''} onClick={() => { setMenuDay(1); setConfirm(null); }}>1日目</button><button className={menuDay === 2 ? 'active' : ''} onClick={() => { setMenuDay(2); setConfirm(null); }}>2日目</button></div></div>
        <div className="add-bar menu-add"><input value={newMenuName} onChange={e => setNewMenuName(e.target.value)} placeholder="メニュー名" /><input value={newMenuPrice} onChange={e => setNewMenuPrice(e.target.value)} placeholder="価格（円）" inputMode="numeric" /><button className="primary-button" onClick={() => void addMenu()}>追加</button></div>
        <div className="menu-list">{menuVisibleMenus.map(menu => <article className="menu-card" key={menu.id}>
          {editingMenu === menu.id ? <div className="edit-row menu-edit"><input value={menuDraft.name} onChange={e => setMenuDraft(v => ({ ...v, name: e.target.value }))} /><input value={menuDraft.price} inputMode="numeric" onChange={e => setMenuDraft(v => ({ ...v, price: e.target.value }))} /><button onClick={() => void saveMenu(menu.id)}>変更</button><button onClick={() => setEditingMenu(null)}>キャンセル</button></div> : <><div className="menu-info"><h3>{menu.name}</h3><strong>{yen(menu.price)}</strong><span className="menu-order-count">注文数：{orders.filter(order => order.menu_id === menu.id && order.lunch_day === menuDay).length}</span></div><div className="menu-actions"><button className="primary-button" onClick={() => { setAddingMenuOrder(v => v === menu.id ? null : menu.id); setSelectedMenuOrderPeople([]); }}>注文に追加</button><button onClick={() => { setEditingMenu(menu.id); setMenuDraft({ name: menu.name, price: String(menu.price) }); }}>編集</button><button className="text-danger" onClick={() => setConfirm({ kind: 'menu', id: menu.id })}>削除</button></div></>}
          {addingMenuOrder === menu.id && <div className="menu-order-picker"><span>注文するメンバーを選択（複数選択可）</span><div className="menu-order-members">{orderedPeople.map(person => <button className={selectedMenuOrderPeople.includes(person.id) ? 'selected' : ''} key={person.id} type="button" aria-pressed={selectedMenuOrderPeople.includes(person.id)} onClick={() => setSelectedMenuOrderPeople(current => current.includes(person.id) ? current.filter(id => id !== person.id) : [...current, person.id])}>{person.name}</button>)}</div><div className="menu-order-footer"><button className="primary-button" disabled={selectedMenuOrderPeople.length === 0} onClick={() => void addMenuOrder(menu)}>追加</button><button type="button" onClick={() => { setAddingMenuOrder(null); setSelectedMenuOrderPeople([]); }}>キャンセル</button></div></div>}
          {confirm?.kind === 'menu' && confirm.id === menu.id && <div className="inline-confirm full-confirm">このメニューと{menuDay}日目の該当注文を削除しますか？<div><button className="danger-button" onClick={() => void deleteMenu(menu.id)}>削除する</button><button onClick={() => setConfirm(null)}>キャンセル</button></div></div>}
        </article>)}</div>
      </section>}
    </>}
    <footer>データはSupabaseに保存され、ほかの端末にもリアルタイムで反映されます。</footer>
  </main>;
}
