'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Person = { id: number; name: string };
type Menu = { id: number; name: string; price: number; hidden: boolean | null; lunch_day: number };
type Order = { id: number; participant_id: number; lunch_day: number; menu_id: number; amount: number; paid: boolean; locked_amount: number | null; cash: number | null };
type Tab = 'account' | 'members' | 'menus';
type Confirm = { kind: 'order' | 'person' | 'menu'; id: number } | null;
const yen = (value: number) => new Intl.NumberFormat('ja-JP').format(value) + '円';

export default function Home() {
  const [people, setPeople] = useState<Person[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [day, setDay] = useState(1);
  const [tab, setTab] = useState<Tab>('account');
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newOrder, setNewOrder] = useState<Record<number, string>>({});
  const [newPerson, setNewPerson] = useState('');
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuPrice, setNewMenuPrice] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [editingPerson, setEditingPerson] = useState<number | null>(null);
  const [personDraft, setPersonDraft] = useState('');
  const [editingMenu, setEditingMenu] = useState<number | null>(null);
  const [menuDraft, setMenuDraft] = useState({ name: '', price: '' });

  const load = useCallback(async () => {
    if (!supabase) { setError('Supabaseの接続設定がありません。'); setLoading(false); return; }
    const [p, m, o] = await Promise.all([
      supabase.from('lunch_participants').select('id,name').order('id'),
      supabase.from('lunch_menus').select('id,name,price,hidden,lunch_day').order('id'),
      supabase.from('lunch_orders').select('id,participant_id,lunch_day,menu_id,amount,paid,locked_amount,cash').order('id')
    ]);
    const issue = p.error || m.error || o.error;
    if (issue) setError(issue.message);
    else { setPeople(p.data ?? []); setMenus(m.data ?? []); setOrders(o.data ?? []); setError(''); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase.channel('lunch-accounting-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lunch_participants' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lunch_menus' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lunch_orders' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  const visibleMenus = useMemo(() => menus.filter(m => m.lunch_day === day && !m.hidden), [menus, day]);
  const dayOrders = useMemo(() => orders.filter(o => o.lunch_day === day), [orders, day]);
  const total = dayOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const peopleCount = new Set(dayOrders.map(o => o.participant_id)).size;
  const filteredPeople = people.filter(person => {
    const mine = dayOrders.filter(o => o.participant_id === person.id);
    if (filter === 'unpaid') return mine.some(o => !o.paid);
    if (filter === 'paid') return mine.length > 0 && mine.every(o => o.paid);
    return true;
  });

  async function addOrder(personId: number) {
    if (!supabase) return;
    const menu = visibleMenus.find(m => m.id === Number(newOrder[personId]));
    if (!menu) return;
    const { error: e } = await supabase.from('lunch_orders').insert({ participant_id: personId, lunch_day: day, menu_id: menu.id, amount: menu.price, paid: false });
    if (e) setError(e.message); else { setNewOrder(v => ({ ...v, [personId]: '' })); await load(); }
  }
  async function deleteOrder(id: number) {
    if (!supabase) return;
    const { error: e } = await supabase.from('lunch_orders').delete().eq('id', id);
    if (e) setError(e.message); else { setConfirm(null); await load(); }
  }
  async function togglePaid(order: Order) {
    if (!supabase) return;
    const { error: e } = await supabase.from('lunch_orders').update({ paid: !order.paid }).eq('id', order.id);
    if (e) setError(e.message); else await load();
  }
  async function addPerson() {
    const name = newPerson.trim();
    if (!supabase || !name) return;
    const { error: e } = await supabase.from('lunch_participants').insert({ name });
    if (e) setError(e.message); else { setNewPerson(''); await load(); }
  }
  async function savePerson(id: number) {
    if (!supabase || !personDraft.trim()) return;
    const { error: e } = await supabase.from('lunch_participants').update({ name: personDraft.trim() }).eq('id', id);
    if (e) setError(e.message); else { setEditingPerson(null); await load(); }
  }
  async function deletePerson(id: number) {
    if (!supabase) return;
    const { error: e } = await supabase.from('lunch_orders').delete().eq('participant_id', id);
    if (e) { setError(e.message); return; }
    const { error: pe } = await supabase.from('lunch_participants').delete().eq('id', id);
    if (pe) setError(pe.message); else { setConfirm(null); await load(); }
  }
  async function addMenu() {
    const name = newMenuName.trim(), price = Number(newMenuPrice);
    if (!supabase || !name || newMenuPrice.trim() === '' || !Number.isFinite(price) || price < 0) return;
    const { error: e } = await supabase.from('lunch_menus').insert({ name, price, lunch_day: day, hidden: false });
    if (e) setError(e.message); else { setNewMenuName(''); setNewMenuPrice(''); await load(); }
  }
  async function saveMenu(id: number) {
    const name = menuDraft.name.trim(), price = Number(menuDraft.price);
    if (!supabase || !name || menuDraft.price.trim() === '' || !Number.isFinite(price) || price < 0) return;
    const { error: e } = await supabase.from('lunch_menus').update({ name, price }).eq('id', id);
    if (e) { setError(e.message); return; }
    const { error: oe } = await supabase.from('lunch_orders').update({ amount: price }).eq('menu_id', id).eq('lunch_day', day);
    if (oe) setError(oe.message); else { setEditingMenu(null); await load(); }
  }
  async function deleteMenu(id: number) {
    if (!supabase) return;
    const { error: oe } = await supabase.from('lunch_orders').delete().eq('menu_id', id).eq('lunch_day', day);
    if (oe) { setError(oe.message); return; }
    const { error: me } = await supabase.from('lunch_menus').delete().eq('id', id);
    if (me) setError(me.message); else { setConfirm(null); await load(); }
  }

  return <main className="shell">
    <header className="topbar">
      <div><p className="eyebrow">LUNCH ACCOUNTING</p><h1>昼食会計アプリ</h1><p className="subtitle">注文・メンバー・メニューをまとめて管理</p></div>
      <div className="day-switch"><button className={day === 1 ? 'active' : ''} onClick={() => { setDay(1); setConfirm(null); }}>1日目</button><button className={day === 2 ? 'active' : ''} onClick={() => { setDay(2); setConfirm(null); }}>2日目</button></div>
    </header>
    <nav className="tabs"><button className={tab === 'account' ? 'selected' : ''} onClick={() => setTab('account')}>会計管理</button><button className={tab === 'members' ? 'selected' : ''} onClick={() => setTab('members')}>メンバー管理</button><button className={tab === 'menus' ? 'selected' : ''} onClick={() => setTab('menus')}>メニュー管理</button></nav>
    {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}>閉じる</button></div>}
    {loading ? <div className="loading">読み込み中…</div> : <>
      {tab === 'account' && <section>
        <div className="summary-grid"><article><span>注文合計</span><strong>{yen(total)}</strong></article><article><span>注文人数</span><strong>{peopleCount}<small>人</small></strong></article><article><span>注文数</span><strong>{dayOrders.length}<small>件</small></strong></article></div>
        <div className="section-heading"><h2>メンバー別の注文</h2><div className="filters"><button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>全員</button><button className={filter === 'unpaid' ? 'on' : ''} onClick={() => setFilter('unpaid')}>未払い</button><button className={filter === 'paid' ? 'on' : ''} onClick={() => setFilter('paid')}>支払済</button></div></div>
        <div className="people-grid">{filteredPeople.map(person => {
          const mine = dayOrders.filter(o => o.participant_id === person.id);
          const subtotal = mine.reduce((sum, o) => sum + Number(o.amount || 0), 0);
          return <article className="person-card" key={person.id}>
            <div className="person-heading"><h3>{person.name}</h3><b>{yen(subtotal)}</b></div>
            {mine.length === 0 ? <p className="muted">注文はありません</p> : <div className="order-list">{mine.map(order => {
              const menu = menus.find(m => m.id === order.menu_id);
              return <div className="order-item" key={order.id}>
                <div className="order-line"><span>{menu?.name ?? '削除済みメニュー'}</span><strong>{yen(order.amount)}</strong></div>
                <div className="order-controls"><label><input type="checkbox" checked={!!order.paid} onChange={() => void togglePaid(order)} />支払済</label><button className="text-danger" onClick={() => setConfirm({ kind: 'order', id: order.id })}>削除</button></div>
                {confirm?.kind === 'order' && confirm.id === order.id && <div className="inline-confirm">この注文を削除しますか？<div><button className="danger-button" onClick={() => void deleteOrder(order.id)}>削除する</button><button onClick={() => setConfirm(null)}>キャンセル</button></div></div>}
              </div>;
            })}</div>}
            <div className="add-order"><select aria-label={person.name + 'の注文を追加'} value={newOrder[person.id] || ''} onChange={e => setNewOrder(v => ({ ...v, [person.id]: e.target.value }))}><option value="">注文を追加</option>{visibleMenus.map(menu => <option key={menu.id} value={menu.id}>{menu.name}（{yen(menu.price)}）</option>)}</select><button className="primary-button" disabled={!newOrder[person.id]} onClick={() => void addOrder(person.id)}>追加</button></div>
          </article>;
        })}</div>
      </section>}
      {tab === 'members' && <section>
        <div className="section-heading block-heading"><div><h2>メンバー管理</h2><p className="muted">メンバーごとの1日目・2日目の注文内容と合計</p></div></div>
        <div className="add-bar"><input value={newPerson} onChange={e => setNewPerson(e.target.value)} placeholder="メンバー名を入力" onKeyDown={e => { if (e.key === 'Enter') void addPerson(); }} /><button className="primary-button" onClick={() => void addPerson()}>メンバーを追加</button></div>
        <div className="member-list">{people.map(person => <article className="member-card" key={person.id}>
          <div className="member-heading">{editingPerson === person.id ? <div className="edit-row"><input value={personDraft} onChange={e => setPersonDraft(e.target.value)} /><button className="primary-button" onClick={() => void savePerson(person.id)}>保存</button><button onClick={() => setEditingPerson(null)}>キャンセル</button></div> : <><h3>{person.name}</h3><div><button onClick={() => { setEditingPerson(person.id); setPersonDraft(person.name); }}>名前変更</button><button className="text-danger" onClick={() => setConfirm({ kind: 'person', id: person.id })}>削除</button></div></>}</div>
          {confirm?.kind === 'person' && confirm.id === person.id && <div className="inline-confirm">このメンバーとすべての注文を削除しますか？<div><button className="danger-button" onClick={() => void deletePerson(person.id)}>削除する</button><button onClick={() => setConfirm(null)}>キャンセル</button></div></div>}
          <div className="member-days">{[1, 2].map(d => { const os = orders.filter(o => o.participant_id === person.id && o.lunch_day === d); return <div key={d}><b>{d}日目</b><span>{os.length}件</span><span className="member-menu-names">{os.map(o => menus.find(m => m.id === o.menu_id)?.name ?? '削除済み').join('、') || '注文なし'}</span><strong>{yen(os.reduce((sum, o) => sum + Number(o.amount || 0), 0))}</strong></div>; })}</div>
        </article>)}</div>
      </section>}
      {tab === 'menus' && <section>
        <div className="section-heading block-heading"><div><h2>メニュー管理</h2><p className="muted">{day}日目のメニュー</p></div></div>
        <div className="add-bar menu-add"><input value={newMenuName} onChange={e => setNewMenuName(e.target.value)} placeholder="メニュー名" /><input value={newMenuPrice} onChange={e => setNewMenuPrice(e.target.value)} placeholder="価格（円）" inputMode="numeric" /><button className="primary-button" onClick={() => void addMenu()}>追加</button></div>
        <div className="menu-list">{visibleMenus.map(menu => <article className="menu-card" key={menu.id}>
          {editingMenu === menu.id ? <div className="edit-row menu-edit"><input value={menuDraft.name} onChange={e => setMenuDraft(v => ({ ...v, name: e.target.value }))} /><input value={menuDraft.price} inputMode="numeric" onChange={e => setMenuDraft(v => ({ ...v, price: e.target.value }))} /><button className="primary-button" onClick={() => void saveMenu(menu.id)}>保存</button><button onClick={() => setEditingMenu(null)}>キャンセル</button></div> : <><div className="menu-info"><h3>{menu.name}</h3><strong>{yen(menu.price)}</strong></div><div className="menu-actions"><button onClick={() => { setEditingMenu(menu.id); setMenuDraft({ name: menu.name, price: String(menu.price) }); }}>編集</button><button className="text-danger" onClick={() => setConfirm({ kind: 'menu', id: menu.id })}>削除</button></div></>}
          {confirm?.kind === 'menu' && confirm.id === menu.id && <div className="inline-confirm full-confirm">このメニューと{day}日目の該当注文を削除しますか？<div><button className="danger-button" onClick={() => void deleteMenu(menu.id)}>削除する</button><button onClick={() => setConfirm(null)}>キャンセル</button></div></div>}
        </article>)}</div>
      </section>}
    </>}
    <footer>データはSupabaseに保存され、ほかの端末にもリアルタイムで反映されます。</footer>
  </main>;
}
