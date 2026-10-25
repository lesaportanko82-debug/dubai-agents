'use client';
import { useEffect, useState } from 'react';

export interface TraceStep { tool: string; input: unknown; output: unknown; label?: string }

const TOOL_LABEL: Record<string, { ru: string; en: string }> = {
  check_duplicate: { ru: 'Проверяю, не было ли уже такого обращения', en: 'Checking whether this ticket was already recorded' },
  find_batch: { ru: 'Ищу партию и завод по артикулу и серийному номеру', en: 'Looking up the batch and factory by SKU and serial' },
  record_case: { ru: 'Записываю случай: код считает стоимость и решает, куда он идёт', en: 'Recording the case: code computes cost and decides where it goes' },
  // domovoy
  parse_tasks: { ru: 'Разбираю сообщение на дела', en: 'Splitting the message into tasks' },
  get_candidates: { ru: 'Смотрю, кто свободен, умеет и кому пора по очереди', en: 'Checking who is free, able and due by fairness' },
  assign_task: { ru: 'Назначаю дело и объясняю выбор', en: 'Assigning the task and explaining the choice' },
  notify: { ru: 'Пишу каждому на его языке', en: 'Messaging each person in their language' },
};

/** Renders agent steps appearing one by one, like a live log. */
export function TraceRail({ steps, lang, summary, animate = true }: { steps: TraceStep[]; lang: 'ru' | 'en'; summary?: string; animate?: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : steps.length);
  useEffect(() => {
    if (!animate) { setShown(steps.length); return; }
    setShown(0);
    let i = 0;
    const id = setInterval(() => { i++; setShown(i); if (i >= steps.length + 1) clearInterval(id); }, 650);
    return () => clearInterval(id);
  }, [steps, animate]);

  return (
    <div className="rail space-y-4">
      {steps.map((s, i) => {
        const visible = i < shown;
        return (
          <div key={i} className={`relative ${visible ? 'rise' : 'opacity-0'}`}>
            <span className={`rail-dot ${visible ? 'active' : 'pending'}`} />
            <div className="text-[14px] font-medium">{TOOL_LABEL[s.tool]?.[lang] ?? s.tool}</div>
            <div className="text-[12px] text-mute font-mono mt-0.5 break-words">→ {s.tool}({compact(s.input)})</div>
            <div className="text-[13px] mt-1 rounded-md bg-stone-50 border border-stone-200 px-3 py-2 font-mono break-words whitespace-pre-wrap">{compact(s.output, 600)}</div>
          </div>
        );
      })}
      {summary && (
        <div className={`relative ${shown > steps.length ? 'rise' : 'opacity-0'}`}>
          <span className="rail-dot active" />
          <div className="text-[14px] font-medium">{lang === 'ru' ? 'Итог агента' : 'Agent summary'}</div>
          <div className="text-[14px] mt-1">{summary}</div>
        </div>
      )}
    </div>
  );
}

function compact(v: unknown, max = 220): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}
