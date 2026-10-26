'use client';

import { useState } from 'react';

interface HouseholdInfo { id: string; name: string }
interface MemberInfo { id: string; name: string; role: string; age?: number; lang: string; isAdmin: boolean }

const ROLE_EMOJI: Record<string, string> = { adult: '👤', child: '🧒', elder: '👵', helper: '🤝' };
const ROLE_RU: Record<string, string> = { adult: 'Взрослый', child: 'Ребёнок', elder: 'Старший', helper: 'Помощник' };

export default function DomovoyLoginPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [members, setMembers] = useState<MemberInfo[]>([]);

  const submitPin = async () => {
    if (pin.length < 4) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/domovoy/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? 'Неверный код. Попробуйте ещё раз.' : 'Ошибка сервера');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setHousehold(data.household);
      setMembers(data.members);
    } catch {
      setError('Нет связи с сервером');
    }
    setLoading(false);
  };

  const enterDemo = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/domovoy/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ demo: true }) });
      if (!res.ok) { setError('Демо недоступно'); setLoading(false); return; }
      window.location.href = '/domovoy';
    } catch { setError('Нет связи с сервером'); setLoading(false); }
  };

  const pickMember = async (memberId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/domovoy/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, memberId }),
      });
      if (!res.ok) { setError('Не удалось войти'); setLoading(false); return; }
      window.location.href = '/domovoy';
    } catch {
      setError('Нет связи с сервером');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-[48px] mb-2">🏠</div>
          <h1 className="text-[22px] font-semibold">Домовёнок</h1>
          <p className="text-[14px] text-stone-500 mt-1">Панель управления семьёй</p>
        </div>

        {!household ? (
          /* Step 1: PIN entry */
          <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
            <label className="block text-[14px] font-medium mb-2">Код семьи</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && submitPin()}
              placeholder="000000"
              autoFocus
              className="w-full text-center text-[28px] tracking-[0.3em] font-mono rounded-lg border border-stone-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
            />
            {error && <p className="text-red-600 text-[13px] mt-2 text-center">{error}</p>}
            <button
              onClick={submitPin}
              disabled={pin.length < 4 || loading}
              className="w-full mt-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium py-3 text-[15px] disabled:opacity-40 transition-colors"
            >
              {loading ? 'Проверяю…' : 'Войти'}
            </button>
            <p className="text-[12px] text-stone-400 mt-4 text-center">
              Код можно узнать у администратора семьи или по команде /panel в Telegram-боте.
            </p>
            <div className="mt-5 pt-4 border-t border-stone-100 text-center">
              <button onClick={enterDemo} disabled={loading} className="text-[14px] font-medium text-amber-700 hover:text-amber-800 disabled:opacity-40">
                Посмотреть демо-семью →
              </button>
              <p className="text-[12px] text-stone-400 mt-1">Синтетические данные: семья из 6 человек в Дубае. Можно всё трогать.</p>
            </div>
          </div>
        ) : (
          /* Step 2: Member picker */
          <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
            <h2 className="text-[16px] font-semibold mb-1">{household.name}</h2>
            <p className="text-[13px] text-stone-500 mb-4">Кто входит?</p>
            <div className="space-y-2">
              {members.map(m => (
                <button
                  key={m.id}
                  onClick={() => pickMember(m.id)}
                  disabled={loading}
                  className="w-full flex items-center gap-3 rounded-lg border border-stone-200 hover:border-amber-400 hover:bg-amber-50 px-4 py-3 text-left transition-colors disabled:opacity-40"
                >
                  <span className="text-[24px]">{ROLE_EMOJI[m.role] ?? '👤'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[15px] truncate">{m.name}</div>
                    <div className="text-[12px] text-stone-500">
                      {ROLE_RU[m.role] ?? m.role}
                      {m.age ? `, ${m.age} лет` : ''}
                      {m.isAdmin ? ' · админ' : ''}
                    </div>
                  </div>
                  <span className="text-stone-300 text-[18px]">→</span>
                </button>
              ))}
            </div>
            {error && <p className="text-red-600 text-[13px] mt-3 text-center">{error}</p>}
            <button
              onClick={() => { setHousehold(null); setMembers([]); setPin(''); }}
              className="w-full mt-4 text-[13px] text-stone-500 hover:text-stone-700"
            >
              ← Другой код
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
