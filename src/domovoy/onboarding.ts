/**
 * Telegram onboarding flow for Домовёнок multi-household mode.
 *
 * Two entry points:
 *  1. /start (no args) → create a new household (admin path)
 *  2. /start <inviteCode> → join an existing household (member path)
 *
 * After /start, conversation is driven by session state stored in dm_tg_sessions.
 * Each step renders a question; user's reply or button advances the state.
 *
 * Admin commands after onboarding:
 *  /add — shows invite link for new members
 *  /family — lists household members + invite link
 */
import type { DomovoyDb, ChatSession } from './supabase-store';
import { newMemberId } from './supabase-store';
import type { TgSender, Button, TgUpdate } from './telegram';
import type { Lang, Role } from './types';
import { ROLE_LABEL, LANG_LABEL, SKILL_LABEL, TZ_OPTIONS, skillsForRole } from './labels';

type L = 'ru' | 'en';
const uiLang = (tgLang?: string): L => tgLang?.startsWith('ru') ? 'ru' : 'en';

const TX = {
  welcome: {
    ru: '🏠 Привет! Я Домовёнок — умный помощник для семьи.\n\nЯ распределяю домашние дела между всеми, отправляю напоминания и слежу за справедливостью.\n\nДавайте создадим вашу семью!',
    en: '🏠 Hi! I am Domovoy — a smart household assistant.\n\nI dispatch chores among the family, send reminders and track fairness.\n\nLet\'s set up your family!',
  },
  askHouseholdName: { ru: 'Как назовём семью? (например «Семья Петровых»)', en: 'What shall we call the family? (e.g. "The Smiths")' },
  askTz: { ru: 'В каком часовом поясе живёт семья?', en: 'What time zone does the family live in?' },
  askLang: { ru: 'Основной язык семьи?', en: 'Family\'s main language?' },
  askAdminName: { ru: 'Как вас зовут? (имя будет видно другим членам семьи)', en: 'What\'s your name? (other family members will see it)' },
  created: {
    ru: (name: string, code: string, botUser: string) =>
      `✅ Семья «${name}» создана! Вы — администратор.\n\n` +
      `Чтобы добавить остальных, отправьте им ссылку:\n` +
      `https://t.me/${botUser}?start=${code}\n\n` +
      `Или используйте /add для повторного показа ссылки, /family для списка.\n\n` +
      `Теперь просто пишите, что нужно сделать — например «завтра в 17 забрать Машу из сада и купить молоко» — и я распределю.`,
    en: (name: string, code: string, botUser: string) =>
      `✅ Family "${name}" is set up! You are the admin.\n\n` +
      `To add members, send them this link:\n` +
      `https://t.me/${botUser}?start=${code}\n\n` +
      `Or use /add to see the link again, /family for the member list.\n\n` +
      `Now just tell me what needs doing — e.g. "pick up Masha at 5pm and buy milk" — and I will dispatch it.`,
  },
  joinWelcome: {
    ru: (family: string) => `👋 Вы присоединяетесь к семье «${family}»! Давайте познакомимся.`,
    en: (family: string) => `👋 You're joining "${family}"! Let me get to know you.`,
  },
  askMemberName: { ru: 'Как вас зовут?', en: 'What\'s your name?' },
  askRole: { ru: 'Кто вы в семье?', en: 'What\'s your role?' },
  askAge: { ru: 'Сколько лет? (нужно для подбора подходящих дел)', en: 'How old? (needed to pick suitable chores)' },
  askSkills: { ru: 'Что умеете / готовы делать? Нажмите всё подходящее, затем «Готово ✅»', en: 'What can you do? Tap everything that applies, then "Done ✅"' },
  joined: {
    ru: (name: string) => `🎉 ${name}, добро пожаловать! Когда вам назначат дело, я напишу сюда. Отвечайте «ок», «не могу» или «готово».`,
    en: (name: string) => `🎉 ${name}, welcome! When a task is assigned to you, I'll message here. Reply "ok", "can't" or "done".`,
  },
  inviteLink: {
    ru: (code: string, botUser: string) => `Ссылка для подключения:\nhttps://t.me/${botUser}?start=${code}`,
    en: (code: string, botUser: string) => `Invite link:\nhttps://t.me/${botUser}?start=${code}`,
  },
  familyList: {
    ru: (name: string, members: string[]) => `👨‍👩‍👧‍👦 «${name}»:\n${members.join('\n')}`,
    en: (name: string, members: string[]) => `👨‍👩‍👧‍👦 "${name}":\n${members.join('\n')}`,
  },
  noHousehold: { ru: 'Вы пока не состоите в семье. Нажмите /start чтобы создать.', en: 'You\'re not in a family yet. Tap /start to create one.' },
  done: { ru: 'Готово ✅', en: 'Done ✅' },
} as const;

const ROLE_EMOJI: Record<Role, string> = { adult: '🧑', child: '🧒', elder: '👵', helper: '🧹' };

export interface OnboardingDeps {
  send: TgSender;
  db: DomovoyDb;
  botUsername: string;
  panelHost?: string;
}

/**
 * Handle an update when there is no linked member yet (or an admin command).
 * Returns true if handled, false if the caller should pass to the normal handler.
 */
export async function handleOnboarding(upd: TgUpdate, deps: OnboardingDeps): Promise<boolean> {
  const chatId = String(upd.message?.chat.id ?? upd.callback_query?.message?.chat.id ?? upd.callback_query?.from.id ?? '');
  if (!chatId) return false;
  const { send, db, botUsername } = deps;
  const l = uiLang(upd.message?.from?.language_code ?? upd.callback_query?.from?.language_code);

  const text = (upd.message?.text ?? upd.message?.caption ?? '').trim();
  const cbData = upd.callback_query?.data;

  // Admin commands: /add, /family, /panel — for linked members
  const linked = await db.memberByChat(chatId);
  if (linked) {
    if (/^\/add\b/.test(text) && linked.member.isAdmin) {
      await send.sendMessage(chatId, TX.inviteLink[l](linked.household.inviteCode, botUsername));
      return true;
    }
    if (/^\/family\b/.test(text)) {
      const store = db.store(linked.household);
      const members = await store.members();
      const lines = members.map(m => `${ROLE_EMOJI[m.role]} ${m.name} (${ROLE_LABEL[m.role][l]})${m.isAdmin ? ' 👑' : ''}${m.telegramId ? ' ✓' : ''}`);
      await send.sendMessage(chatId, TX.familyList[l](linked.household.name, lines) + '\n\n' + TX.inviteLink[l](linked.household.inviteCode, botUsername));
      return true;
    }
    if (/^\/panel\b/.test(text)) {
      const token = await db.createPanelSession(linked.household.id, linked.member.id);
      const host = deps.panelHost ?? 'dubai-agents.vercel.app';
      const pin = linked.household.pin;
      await send.sendMessage(chatId,
        l === 'ru'
          ? `📊 Веб-панель вашей семьи:\nhttps://${host}/api/domovoy/auth?token=${token}\n\n` +
            `Или откройте https://${host}/login/domovoy\nКод семьи: ${pin}\n\nСсылка действует 30 дней.`
          : `📊 Your family dashboard:\nhttps://${host}/api/domovoy/auth?token=${token}\n\n` +
            `Or open https://${host}/login/domovoy\nFamily code: ${pin}\n\nLink valid for 30 days.`,
      );
      return true;
    }
    return false; // let the normal handler deal with it
  }

  // Load or create session
  let session = await db.session(chatId);

  // /start with invite code → join flow
  if (/^\/start\b/.test(text)) {
    const inviteCode = text.split(/\s+/)[1];
    if (inviteCode) {
      const h = await db.householdByInvite(inviteCode);
      if (h) {
        session = { householdId: h.id, state: { step: 'join_name' } };
        await db.setSession(chatId, session);
        await send.sendMessage(chatId, TX.joinWelcome[l](h.name) + '\n\n' + TX.askMemberName[l]);
        return true;
      }
      // bad invite code — fall through to create
    }
    // No invite → create flow
    session = { state: { step: 'create_name', lang: l } };
    await db.setSession(chatId, session);
    await send.sendMessage(chatId, TX.welcome[l] + '\n\n' + TX.askHouseholdName[l]);
    return true;
  }

  // Route by session step
  const step = session.state?.step as string | undefined;
  if (!step) {
    // No active session, not linked — just hint
    if (text) await send.sendMessage(chatId, TX.noHousehold[l]);
    return true;
  }

  // ---------- CREATE HOUSEHOLD FLOW ----------
  if (step === 'create_name' && text) {
    session.state.householdName = text;
    session.state.step = 'create_tz';
    await db.setSession(chatId, session);
    const buttons: Button[][] = TZ_OPTIONS.map(o => [{ text: `${o[l]} (${o.tz.split('/')[1]})`, data: `tz:${o.tz}` }]);
    await send.sendMessage(chatId, TX.askTz[l], buttons);
    return true;
  }
  if (step === 'create_tz' && cbData?.startsWith('tz:')) {
    const tz = cbData.slice(3);
    session.state.tz = tz;
    session.state.step = 'create_lang';
    await db.setSession(chatId, session);
    if (upd.callback_query) await send.answerCallback(upd.callback_query.id);
    const langButtons: Button[][] = (['ru', 'en', 'tl', 'ar', 'tr', 'hi'] as Lang[]).map(lng => [{ text: LANG_LABEL[lng], data: `lang:${lng}` }]);
    await send.sendMessage(chatId, TX.askLang[l], langButtons);
    return true;
  }
  if (step === 'create_lang' && cbData?.startsWith('lang:')) {
    const lang = cbData.slice(5) as Lang;
    session.state.lang = lang;
    session.state.step = 'create_admin_name';
    await db.setSession(chatId, session);
    if (upd.callback_query) await send.answerCallback(upd.callback_query.id);
    await send.sendMessage(chatId, TX.askAdminName[l]);
    return true;
  }
  if (step === 'create_admin_name' && text) {
    // Create the household + admin member
    const h = await db.createHousehold({
      name: session.state.householdName as string,
      tz: (session.state.tz ?? 'Asia/Dubai') as string,
      lang: (session.state.lang ?? 'ru') as Lang,
    });
    const store = db.store(h);
    const memberId = newMemberId();
    await store.saveMember({
      id: memberId, name: text, role: 'adult', lang: h.lang,
      telegramId: chatId, skills: [...Object.keys(SKILL_LABEL)],
      busy: [], dailyLimit: 5, isAdmin: true, messageStyle: 'direct',
    });
    // Clear session
    session = { householdId: h.id, memberId, state: {} };
    await db.setSession(chatId, session);
    await send.sendMessage(chatId, TX.created[l](h.name, h.inviteCode, botUsername));
    // Send PIN for web panel access
    const host = deps.panelHost ?? 'dubai-agents.vercel.app';
    await send.sendMessage(chatId,
      l === 'ru'
        ? `🔑 Код доступа к веб-панели: ${h.pin}\nОткройте https://${host}/login/domovoy и введите его.\nИли используйте /panel для одноразовой ссылки.`
        : `🔑 Web panel access code: ${h.pin}\nOpen https://${host}/login/domovoy and enter it.\nOr use /panel for a one-time link.`,
    );
    return true;
  }

  // ---------- JOIN HOUSEHOLD FLOW ----------
  if (step === 'join_name' && text) {
    session.state.memberName = text;
    session.state.step = 'join_role';
    await db.setSession(chatId, session);
    const roleButtons: Button[][] = (['adult', 'child', 'elder', 'helper'] as Role[]).map(r => [{ text: `${ROLE_EMOJI[r]} ${ROLE_LABEL[r][l]}`, data: `role:${r}` }]);
    await send.sendMessage(chatId, TX.askRole[l], roleButtons);
    return true;
  }
  if (step === 'join_role' && cbData?.startsWith('role:')) {
    const role = cbData.slice(5) as Role;
    session.state.role = role;
    if (upd.callback_query) await send.answerCallback(upd.callback_query.id);
    if (role === 'child') {
      session.state.step = 'join_age';
      await db.setSession(chatId, session);
      await send.sendMessage(chatId, TX.askAge[l]);
    } else {
      session.state.step = 'join_skills';
      session.state.selectedSkills = [];
      await db.setSession(chatId, session);
      await sendSkillPicker(send, chatId, l, role, undefined, []);
    }
    return true;
  }
  if (step === 'join_age' && text) {
    const age = parseInt(text, 10);
    if (isNaN(age) || age < 3 || age > 17) {
      await send.sendMessage(chatId, l === 'ru' ? 'Введите возраст от 3 до 17.' : 'Enter age from 3 to 17.');
      return true;
    }
    session.state.age = age;
    session.state.step = 'join_skills';
    session.state.selectedSkills = [];
    await db.setSession(chatId, session);
    await sendSkillPicker(send, chatId, l, session.state.role as Role, age, []);
    return true;
  }
  if (step === 'join_skills' && cbData?.startsWith('skill:')) {
    const skill = cbData.slice(6);
    if (upd.callback_query) await send.answerCallback(upd.callback_query.id);
    const selected = (session.state.selectedSkills as string[]) ?? [];
    if (skill === 'done') {
      // Finalize member creation
      const h = await db.household(session.householdId!);
      if (!h) return true;
      const store = db.store(h);
      const memberId = newMemberId();
      const role = session.state.role as Role;
      const age = session.state.age as number | undefined;
      await store.saveMember({
        id: memberId, name: session.state.memberName as string, role, age,
        lang: h.lang, telegramId: chatId, skills: selected,
        busy: [], dailyLimit: role === 'child' ? 2 : role === 'helper' ? 4 : 3,
        isAdmin: false, messageStyle: role === 'child' ? 'quest' : role === 'elder' ? 'gentle' : role === 'helper' ? 'formal' : 'direct',
      });
      const savedName = session.state.memberName as string;
      session = { householdId: h.id, memberId, state: {} };
      await db.setSession(chatId, session);
      await send.sendMessage(chatId, TX.joined[l](savedName));
      // Notify admins
      const members = await store.members();
      const newM = members.find(m => m.id === memberId)!;
      const admins = members.filter(m => m.isAdmin && m.telegramId && m.id !== memberId);
      for (const a of admins) {
        await send.sendMessage(a.telegramId!, `👋 ${newM.name} (${ROLE_LABEL[role][l === 'ru' ? 'ru' : 'en']}) ${l === 'ru' ? 'присоединился к семье' : 'joined the family'}.`);
      }
      return true;
    }
    // toggle skill
    const idx = selected.indexOf(skill);
    if (idx >= 0) selected.splice(idx, 1); else selected.push(skill);
    session.state.selectedSkills = selected;
    await db.setSession(chatId, session);
    await sendSkillPicker(send, chatId, l, session.state.role as Role, session.state.age as number | undefined, selected);
    return true;
  }

  // Unhandled state — just show hint
  if (text) await send.sendMessage(chatId, TX.noHousehold[l]);
  return true;
}

async function sendSkillPicker(send: TgSender, chatId: string, l: L, role: Role, age: number | undefined, selected: string[]) {
  const available = skillsForRole(role, age);
  const buttons: Button[][] = [];
  for (let i = 0; i < available.length; i += 2) {
    buttons.push(available.slice(i, i + 2).map(s => ({
      text: `${selected.includes(s) ? '✅ ' : ''}${SKILL_LABEL[s]?.[l] ?? s}`,
      data: `skill:${s}`,
    })));
  }
  buttons.push([{ text: TX.done[l], data: 'skill:done' }]);
  await send.sendMessage(chatId, TX.askSkills[l], buttons);
}
