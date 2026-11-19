'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

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
  const [people, setPeople] = useState<Person[]>([]);
  const [directory, setDirectory] = useState<DirectoryMember[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [cashDraft, setCashDraft] = useState<Record<string, string>>({});
  const [day, setDay] = useState(1);
  const [tab, setTab] = useState<Tab>('account');
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  const load = useCallback(async () => {
    if (!supabase) { setError('Supabaseの接続設定がありません。'); setLoading(false); return; }
    const [p, m, o, st, dir] = await Promise.all([
      supabase.from('lunch_participants').select('id,name').order('id'),
      supabase.from('lunch_menus').select('id,name,price,hidden,lunch_day').order('id'),
      supabase.from('lunch_orders').select('id,participant_id,lunch_day,menu_id,amount,paid,locked_amount,cash').order('id'),
      supabase.from('lunch_settlements').select('participant_id,lunch_day,paid,cash'),
      supabase.from('lunch_member_directory').select('id,name').order('name')
    ]);
    const issue = p.error || m.error || o.error || st.error || dir.error;
    if (issue) setError(issue.message);
    else {
      setPeople(p.data ?? []); setDirectory(dir.data ?? []); setMenus(m.data ?? []); setOrders(o.data ?? []); setSettlements(st.data ?? []);
      setCashDraft(() => { const next: Record<string, string> = {}; for (const item of (st.data ?? []) as Settlement[]) next[`${item.participant_id}-${item.lunch_day}`] = item.cash == null ? '' : String(item.cash); return next; });
      setError('');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const channel = client.channel('lunch-accounting-live')
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
  const dayOrders = useMemo(() => orders.filter(o => o.lunch_day === day), [orders, day]);
  const total = dayOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const peopleCount = new Set(dayOrders.map(o => o.participant_id)).size;
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
    const { error: e } = await supabase.from('lunch_orders').insert({ participant_id: personId, lunch_day: day, menu_id: menu.id, amount: menu.price, paid: false });
    if (e) setError(e.message); else {
      await supabase.from('lunch_settlements').upsert({ participant_id: personId, lunch_day: day, paid: false }, { onConflict: 'participant_id,lunch_day' });
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
    const { error: e } = await supabase.from('lunch_settlements').upsert({ participant_id: personId, lunch_day: day, paid: current?.paid ?? false, cash: current?.cash ?? null, ...patch }, { onConflict: 'participant_id,lunch_day' });
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
      setNewPerson(''); setError('このメンバーは既に今回の一覧に登録されています。'); await load(); return;
    }
    const { error: e } = await supabase.from('lunch_participants').insert({ name });
    if (e) setError(e.message); else { setNewPerson(''); setMemberDropdownOpen(false); await load(); }
  }
  async function activateDirectoryMember(member: DirectoryMember) {
    if (!supabase || people.some(p => p.name.toLocaleLowerCase() === member.name.toLocaleLowerCase())) return;
    const { error: e } = await supabase.from('lunch_participants').insert({ name: member.name });
    if (e) setError(e.message); else await load();
  }
  async function deleteDirectoryMember(id: number) {
    if (!supabase) return;
    const { error: e } = await supabase.from('lunch_member_directory').delete().eq('id', id);
    if (e) setError(e.message); else { setConfirm(null); await load(); }
  }
  async function savePerson(id: number) {
    if (!supabase || !personDraft.trim()) return;
    const current = people.find(p => p.id === id);
    const { error: e } = await supabase.from('lunch_participants').update({ name: personDraft.trim() }).eq('id', id);
    if (e) { setError(e.message); return; }
    if (current && current.name !== personDraft.trim()) {
      const { error: de } = await supabase.from('lunch_member_directory').upsert({ name: personDraft.trim() }, { onConflict: 'name' });
      if (de) { setError(de.message); return; }
      await supabase.from('lunch_member_directory').delete().eq('name', current.name);
    }
    setEditingPerson(null); await load();
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
        <div className="section-heading block-heading"><div><h2>メンバー管理</h2><p className="muted">メンバーごとの1日目・2日目の注文内容と合計</p></div></div>
        <div className="member-picker">
          <button type="button" className="member-picker-trigger" aria-expanded={memberDropdownOpen} onClick={() => setMemberDropdownOpen(v => !v)}>
            <span>保存メンバーから今回の参加者を追加</span><span className="member-picker-count">保存名簿 {directory.length}名</span><span className="member-picker-chevron">{memberDropdownOpen ? '▲' : '▼'}</span>
          </button>
          {memberDropdownOpen && <div className="member-picker-panel">
            <div className="member-picker-list">{directory.map(member => {
              const active = people.some(p => p.name.toLocaleLowerCase() === member.name.toLocaleLowerCase());
              return <div className="member-picker-item" key={member.id}>
                <span>{member.name}</span>
                <div className="member-picker-actions">
                  {confirm?.kind === 'directory' && confirm.id === member.id
                    ? <div className="member-picker-confirm"><span>保存名簿から削除しますか？</span><button type="button" className="danger-button" onClick={() => void deleteDirectoryMember(member.id)}>削除する</button><button type="button" onClick={() => setConfirm(null)}>キャンセル</button></div>
                    : <><button type="button" className="primary-button" disabled={active} onClick={() => void activateDirectoryMember(member)}>{active ? '今回登録済み' : '今回に追加'}</button><button type="button" className="text-danger" onClick={() => setConfirm({ kind: 'directory', id: member.id })}>名簿から削除</button></>}
                </div>
              </div>;
            })}</div>
            <div className="member-picker-add"><input value={newPerson} onChange={e => setNewPerson(e.target.value)} placeholder="新しいメンバー名を入力" onKeyDown={e => { if (e.key === 'Enter') void addPerson(); }} /><button className="primary-button" onClick={() => void addPerson()} disabled={!newPerson.trim()}>名簿に登録して今回に追加</button></div>
          </div>}
        </div>
        <div className="member-list">{orderedPeople.map(person => <article className="member-card" key={person.id}>
          <div className="member-heading">{editingPerson === person.id ? <div className="edit-row"><input value={personDraft} onChange={e => setPersonDraft(e.target.value)} /><button className="primary-button" onClick={() => void savePerson(person.id)}>保存</button><button onClick={() => setEditingPerson(null)}>キャンセル</button></div> : <><h3>{person.name}</h3><div><button onClick={() => { setEditingPerson(person.id); setPersonDraft(person.name); }}>名前変更</button><button className="text-danger" onClick={() => setConfirm({ kind: 'person', id: person.id })}>削除</button></div></>}</div>
          {confirm?.kind === 'person' && confirm.id === person.id && <div className="inline-confirm">このメンバーと今回の注文を削除しますか？<div><button className="danger-button" onClick={() => void deletePerson(person.id)}>削除する</button><button onClick={() => setConfirm(null)}>キャンセル</button></div></div>}
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
