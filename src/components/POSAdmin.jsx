import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const CATEGORIES = ['food', 'beverage', 'merchandise', 'ticket', 'other'];
const CAT_LABELS = { food: 'Food', beverage: 'Beverage', merchandise: 'Merch', ticket: 'Ticket', other: 'Other' };
const CAT_COLORS = { food: 'var(--green)', beverage: '#4a9eff', merchandise: 'var(--gold)', ticket: 'var(--red)', other: 'var(--text3)' };

function blankItem() {
  return { name: '', description: '', category: 'food', price: '', tax_rate: 0.06, available: true, track_inventory: false, inventory_qty: '', event_id: null, sort_order: 0 };
}

export default function POSAdmin({ tenantId, venue, events = [] }) {
  const [view, setView] = useState('catalog');
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [catFilter, setCatFilter] = useState('all');
  const [editItem, setEditItem] = useState(null);
  const [mods, setMods] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoaded(false);
    const { data } = await supabase
      .from('pos_items')
      .select('*, pos_modifiers(*)')
      .eq('tenant_id', tenantId)
      .order('category').order('sort_order').order('name');
    setItems(data || []);
    setLoaded(true);
  }

  function openNew() {
    setEditItem({ ...blankItem(), tenant_id: tenantId });
    setMods([]);
    setView('edit');
  }

  function openEdit(item) {
    setEditItem({ ...item });
    setMods((item.pos_modifiers || []).map(m => ({
      ...m,
      options: Array.isArray(m.options) ? m.options.map(o => ({ ...o })) : [],
    })));
    setView('edit');
  }

  async function toggleAvailable(item) {
    const val = !item.available;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, available: val } : i));
    await supabase.from('pos_items').update({ available: val }).eq('id', item.id);
  }

  async function deleteItem(item) {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    setDeleting(item.id);
    await supabase.from('pos_items').delete().eq('id', item.id);
    setItems(prev => prev.filter(i => i.id !== item.id));
    setDeleting(null);
  }

  async function save() {
    const price = parseFloat(editItem.price);
    if (!editItem.name.trim() || isNaN(price) || price < 0) return;
    setSaving(true);

    const payload = {
      tenant_id: tenantId,
      name: editItem.name.trim(),
      description: editItem.description?.trim() || null,
      category: editItem.category,
      price,
      tax_rate: parseFloat(editItem.tax_rate) || 0.06,
      available: editItem.available,
      track_inventory: editItem.track_inventory,
      inventory_qty: editItem.track_inventory ? (parseInt(editItem.inventory_qty) || 0) : null,
      event_id: editItem.event_id || null,
      sort_order: parseInt(editItem.sort_order) || 0,
    };

    let itemId = editItem.id;
    if (itemId) {
      await supabase.from('pos_items').update(payload).eq('id', itemId);
    } else {
      const { data } = await supabase.from('pos_items').insert(payload).select().single();
      itemId = data?.id;
    }

    if (itemId) {
      await supabase.from('pos_modifiers').delete().eq('item_id', itemId);
      const validMods = mods.filter(m => m.name.trim() && m.options.some(o => o.label.trim()));
      if (validMods.length > 0) {
        await supabase.from('pos_modifiers').insert(
          validMods.map((m, i) => ({
            item_id: itemId,
            name: m.name.trim(),
            required: m.required,
            sort_order: i,
            options: m.options
              .filter(o => o.label.trim())
              .map(o => ({ label: o.label.trim(), price_delta: parseFloat(o.price_delta) || 0 })),
          }))
        );
      }
    }

    setSaving(false);
    setView('catalog');
    load();
  }

  const addMod = () => setMods(prev => [...prev, { name: '', required: false, sort_order: 0, options: [{ label: '', price_delta: 0 }] }]);
  const removeMod = i => setMods(prev => prev.filter((_, idx) => idx !== i));
  const updateMod = (i, key, val) => setMods(prev => prev.map((m, idx) => idx === i ? { ...m, [key]: val } : m));
  const addOption = mi => setMods(prev => prev.map((m, i) => i === mi ? { ...m, options: [...m.options, { label: '', price_delta: 0 }] } : m));
  const removeOption = (mi, oi) => setMods(prev => prev.map((m, i) => i === mi ? { ...m, options: m.options.filter((_, j) => j !== oi) } : m));
  const updateOption = (mi, oi, key, val) => setMods(prev => prev.map((m, i) => i === mi ? { ...m, options: m.options.map((o, j) => j === oi ? { ...o, [key]: val } : o) } : m));

  // ── Edit view ──
  if (view === 'edit' && editItem) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button className="btn" onClick={() => setView('catalog')}>← Back</button>
          <h2 className="dsp" style={{ fontSize: 24, margin: 0 }}>{editItem.id ? 'Edit Item' : 'New Item'}</h2>
        </div>

        <div style={{ maxWidth: 560 }}>
          <div style={{ marginBottom: 14 }}>
            <label className="fl">Item Name *</label>
            <input className="fi" value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Draft Beer" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="fl">Description</label>
            <input className="fi" value={editItem.description || ''} onChange={e => setEditItem(p => ({ ...p, description: e.target.value }))} placeholder="Optional" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="fl">Category *</label>
              <select className="fi" value={editItem.category} onChange={e => setEditItem(p => ({ ...p, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <label className="fl">Price *</label>
              <input className="fi" type="number" min="0" step="0.01" value={editItem.price} onChange={e => setEditItem(p => ({ ...p, price: e.target.value }))} placeholder="0.00" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="fl">Tax Rate <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(default 6%)</span></label>
              <select className="fi" value={editItem.tax_rate} onChange={e => setEditItem(p => ({ ...p, tax_rate: parseFloat(e.target.value) }))}>
                <option value={0}>0% — no tax</option>
                <option value={0.06}>6% — Idaho standard</option>
                <option value={0.0} disabled>─────────</option>
                <option value={0.05}>5% — custom</option>
                <option value={0.07}>7% — custom</option>
                <option value={0.08}>8% — custom</option>
                <option value={0.1}>10% — custom</option>
              </select>
            </div>
            <div>
              <label className="fl">Sort Order <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(lower = first)</span></label>
              <input className="fi" type="number" min="0" step="1" value={editItem.sort_order} onChange={e => setEditItem(p => ({ ...p, sort_order: e.target.value }))} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="fl">Event Scope</label>
            <select className="fi" value={editItem.event_id || ''} onChange={e => setEditItem(p => ({ ...p, event_id: e.target.value || null }))}>
              <option value="">All events</option>
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
              <input type="checkbox" checked={editItem.available} onChange={e => setEditItem(p => ({ ...p, available: e.target.checked }))} />
              Available for sale
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
              <input type="checkbox" checked={editItem.track_inventory} onChange={e => setEditItem(p => ({ ...p, track_inventory: e.target.checked }))} />
              Track inventory
            </label>
          </div>

          {editItem.track_inventory && (
            <div style={{ marginBottom: 14 }}>
              <label className="fl">Quantity in Stock</label>
              <input className="fi" type="number" min="0" step="1" value={editItem.inventory_qty || ''} onChange={e => setEditItem(p => ({ ...p, inventory_qty: e.target.value }))} placeholder="0" style={{ maxWidth: 140 }} />
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18, marginTop: 8, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <h3 className="dsp" style={{ fontSize: 16, margin: 0 }}>Modifiers</h3>
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>e.g. "Size" with options 12oz (+$0), 16oz (+$2), 32oz (+$5)</p>
              </div>
              <button className="btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addMod}>+ Add Group</button>
            </div>
            {mods.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>No modifier groups.</div>}
            {mods.map((mod, mi) => (
              <div key={mi} style={{ background: 'var(--bg3)', borderRadius: 'var(--rs)', padding: 14, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                  <input className="fi" value={mod.name} onChange={e => updateMod(mi, 'name', e.target.value)} placeholder="Group name (e.g. Size)" style={{ flex: 1, margin: 0 }} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    <input type="checkbox" checked={mod.required} onChange={e => updateMod(mi, 'required', e.target.checked)} /> Required
                  </label>
                  <button className="btn" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--red)' }} onClick={() => removeMod(mi)}>✕</button>
                </div>
                {mod.options.map((opt, oi) => (
                  <div key={oi} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <input className="fi" value={opt.label} onChange={e => updateOption(mi, oi, 'label', e.target.value)} placeholder="Label" style={{ flex: 1, margin: 0, fontSize: 13 }} />
                    <input className="fi" type="number" step="0.01" value={opt.price_delta} onChange={e => updateOption(mi, oi, 'price_delta', e.target.value)} placeholder="+0.00" style={{ width: 80, margin: 0, fontSize: 13 }} title="Price adjustment" />
                    {mod.options.length > 1 && (
                      <button className="btn" style={{ fontSize: 11, padding: '2px 7px' }} onClick={() => removeOption(mi, oi)}>✕</button>
                    )}
                  </div>
                ))}
                <button className="btn" style={{ fontSize: 11, padding: '3px 8px', marginTop: 4 }} onClick={() => addOption(mi)}>+ Option</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn gold" onClick={save} disabled={saving || !editItem.name.trim() || editItem.price === ''}>
              {saving ? 'Saving…' : editItem.id ? 'Save Changes' : 'Add Item'}
            </button>
            <button className="btn" onClick={() => setView('catalog')}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Catalog view ──
  const catCounts = {};
  for (const item of items) catCounts[item.category] = (catCounts[item.category] || 0) + 1;
  const filteredItems = catFilter === 'all' ? items : items.filter(i => i.category === catFilter);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 className="dsp" style={{ fontSize: 26 }}>Item Catalog</h2>
        <button className="btn gold" onClick={openNew}>+ New Item</button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {[['all', 'All', items.length], ...CATEGORIES.filter(c => catCounts[c]).map(c => [c, CAT_LABELS[c], catCounts[c]])].map(([val, label, count]) => (
          <button key={val} className={`btn${catFilter === val ? ' gold' : ''}`} style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => setCatFilter(val)}>
            {label} <span style={{ opacity: 0.7, fontSize: 11, marginLeft: 2 }}>({count})</span>
          </button>
        ))}
      </div>

      {!loaded
        ? <div className="empty"><p>Loading…</p></div>
        : filteredItems.length === 0
        ? <div className="empty"><p>{items.length === 0 ? 'No items yet. Add your first item to get started.' : 'No items in this category.'}</p></div>
        : <div style={{ overflowX: 'auto' }}>
            <table className="dt">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Modifiers</th>
                  <th>Event</th>
                  <th>Available</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => (
                  <tr key={item.id} style={{ opacity: item.available ? 1 : 0.55 }}>
                    <td style={{ fontWeight: 600 }}>
                      {item.name}
                      {item.description && <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>{item.description}</div>}
                      {item.track_inventory && (
                        <div style={{ fontSize: 11, color: item.inventory_qty === 0 ? 'var(--red)' : 'var(--text3)' }}>
                          Stock: {item.inventory_qty ?? '—'}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: CAT_COLORS[item.category] || 'var(--text3)' }}>
                        {CAT_LABELS[item.category] || item.category}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700, color: 'var(--gold)' }}>${parseFloat(item.price).toFixed(2)}</td>
                    <td style={{ color: 'var(--text3)', fontSize: 12 }}>
                      {(item.pos_modifiers || []).length > 0
                        ? (item.pos_modifiers || []).map(m => m.name).join(', ')
                        : '—'}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text3)' }}>
                      {item.event_id ? (events.find(e => e.id === item.event_id)?.title || 'Specific event') : 'All events'}
                    </td>
                    <td>
                      <button
                        className={`btn${item.available ? ' gold' : ''}`}
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => toggleAvailable(item)}
                      >
                        {item.available ? 'On' : 'Off'}
                      </button>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn" style={{ fontSize: 12 }} onClick={() => openEdit(item)}>Edit</button>
                        <button
                          className="btn"
                          style={{ fontSize: 12, color: 'var(--red)' }}
                          disabled={deleting === item.id}
                          onClick={() => deleteItem(item)}
                        >
                          {deleting === item.id ? '…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
    </div>
  );
}
