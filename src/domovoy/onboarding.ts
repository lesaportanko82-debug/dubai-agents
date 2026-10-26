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
  askAdminName: {
    ru: '👤 Теперь о вас. Вам я тоже буду давать дела, поэтому познакомимся.\n\nКак вас зовут? (имя увидят остальные члены семьи)',
    en: '👤 Now about you. I will give you tasks too, so let\'s get acquainted.\n\nWhat\'s your name? (other family members will see it)',
  },
  askAdminRole: { ru: 'Кто вы в семье?', en: 'What is your role in the family?' },
  created: {
    ru: (name: string, code: string, botUser: string) =>
      `✅ Семья «${name}» создана, вы — администратор.\n\n` +
      `Теперь пригласите остальных: перешлите им эту ссылку. Каждый пройдёт такое же короткое знакомство, а я буду сообщать вам, кто присоединился.\n\n` +
      `https://t.me/${botUser}?start=${code}\n\n` +
      `Когда все будут в семье — нажмите «Все в сборе». Если пока вы одни — тоже нажимайте, пригласить можно позже через /add.`,
    en: (name: string, code: string, botUser: string) =>
      `✅ Family "${name}" is set up, you are the admin.\n\n` +
      `Now invite the others: forward them this link. Each will go through the same short introduction, and I will tell you who has joined.\n\n` +
      `https://t.me/${botUser}?start=${code}\n\n` +
      `When everyone is in, tap "Everyone's here". On your own for now? Tap it anyway — you can invite people later with /add.`,
  },
  readyButton: { ru: '✅ Все в сборе', en: '✅ Everyone\'s here' },
  familyReady: {
    ru: (name: string, members: string[]) => `🎉 Отлично, все в сборе! В семье «${name}»:\n${members.join('\n')}`,
    en: (name: string, members: string[]) => `🎉 Great, everyone is here! In "${name}":\n${members.join('\n')}`,
  },
  guide: {
    ru: '📖 Теперь расскажу, как мною управлять. Это просто.\n\n' +
      '📝 Пишите или говорите как обычному человеку. «Завтра в 17 забрать Машу из сада и купить молоко» — я сам разберу это на дела, выберу, кому они подходят, и напишу каждому лично, на его языке.\n\n' +
      '🔔 Я слежу, чтобы дела были сделаны. Человек отвечает «ок», «не могу» или «готово». Молчит — напомню, отказался — передам другому.\n\n' +
      '🛡 Важное решаете вы. Расписание детей, траты выше лимита, личные данные — тут я всегда спрошу кнопками «да / нет».\n\n' +
      '🌦 Я сам замечаю проблемы: дождь во время прогулки, накладку в календаре — и предлагаю решение.\n\n' +
      '🧠 Я учусь. Со временем вопросов станет меньше: привычные дела начну назначать сам и объясню почему.\n\n' +
      '🛒 «Закажи молоко» — соберу корзину и пришлю тому, кто платит. Правила трат — /wallet.\n\n' +
      '📌 Команды: /family — кто в семье, /add — пригласить ещё, /panel — веб-панель, /learned — чему я научился, /impact — сколько времени я сэкономил.',
    en: '📖 Here is how to work with me. It is simple.\n\n' +
      '📝 Write or talk to me like a person. "Pick up Masha at 5pm tomorrow and buy milk" — I split it into tasks, pick who fits each one, and message every person directly, in their language.\n\n' +
      '🔔 I make sure things get done. People reply "ok", "can\'t" or "done". Silence — I remind; a decline — I pass it to someone else.\n\n' +
      '🛡 You decide what matters. Children\'s schedules, spending above the limit, personal data — I always ask with "yes / no" buttons.\n\n' +
      '🌦 I spot problems myself: rain during a walk, a calendar clash — and suggest a fix.\n\n' +
      '🧠 I learn. Over time I ask less: routine chores I start assigning myself and explain why.\n\n' +
      '🛒 "Order milk" — I build a cart and send it to whoever pays. Spending rules — /wallet.\n\n' +
      '📌 Commands: /family — who is in, /add — invite more, /panel — web panel, /learned — what I have learned, /impact — time I have saved.',
  },
  tryMe: {
    ru: '🚀 Попробуйте прямо сейчас: надиктуйте голосовое или напишите список дел на сегодня-завтра — я распределю их между всеми.',
    en: '🚀 Try it now: send a voice note or type a list of things to do today or tomorrow — I will spread them across the family.',
  },
  panelCode: {
    ru: (pin: string, host: string) => `🔑 И последнее — веб-панель семьи. Там видно все дела, решения, траты и то, чему я научился.\n\nОткройте https://${host}/login/domovoy и введите код: ${pin}\nИли нажмите /panel — пришлю личную ссылку.`,
    en: (pin: string, host: string) => `🔑 One last thing — the family web panel. It shows every task, decision, payment and what I have learned.\n\nOpen https://${host}/login/domovoy and enter the code: ${pin}\nOr tap /panel for a personal link.`,
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
    ru: (name: string) => `🎉 ${name}, добро пожаловать в семью!\n\nКак это работает: когда вам назначат дело, я напишу сюда. Отвечайте «ок», «не могу» или «готово» — или нажимайте кнопки. Если не можете, я передам дело другому, без обид.\n\nСвои просьбы тоже можно писать или надиктовывать мне — я распределю их по семье.`,
    en: (name: string) => `🎉 ${name}, welcome to the family!\n\nHow it works: when a task is assigned to you, I will message here. Reply "ok", "can't" or "done" — or tap the buttons. If you can't, I pass it to someone else, no hard feelings.\n\nYou can also write or send voice notes with your own requests — I will spread them across the family.`,
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
    if ((cbData === 'fam:ready' || /^\/ready\b/.test(text)) && linked.member.isAdmin) {
      if (upd.callback_query) await send.answerCallback(upd.callback_query.id);
      const members = await db.store(linked.household).members();
      const lines = members.map(m => `${ROLE_EMOJI[m.role]} ${m.name} (${ROLE_LABEL[m.role][l]})${m.isAdmin ? ' 👑' : ''}`);
      await send.sendMessage(chatId, TX.familyReady[l](linked.household.name, lines));
      await send.sendMessage(chatId, TX.guide[l]);
      await send.sendMessage(chatId, TX.tryMe[l]);
      await send.sendMessage(chatId, TX.panelCode[l](linked.household.pin, deps.panelHost ?? 'dubai-agents.vercel.app'));
      return true;
    }
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
    session.state.memberName = text;
    session.state.step = 'create_admin_role';
    await db.setSession(chatId, session);
    const roleButtons: Button[][] = (['adult', 'elder', 'helper'] as Role[]).map(r => [{ text: `${ROLE_EMOJI[r]} ${ROLE_LABEL[r][l]}`, data: `role:${r}` }]);
    await send.sendMessage(chatId, TX.askAdminRole[l], roleButtons);
    return true;
  }
  if (step === 'create_admin_role' && cbData?.startsWith('role:')) {
    const role = cbData.slice(5) as Role;
    if (upd.callback_query) await send.answerCallback(upd.callback_query.id);
    session.state.role = role === 'child' ? 'adult' : role;
    session.state.step = 'create_admin_skills';
    session.state.selectedSkills = [];
    await db.setSession(chatId, session);
    await sendSkillPicker(send, chatId, l, session.state.role as Role, undefined, []);
    return true;
  }
  if (step === 'create_admin_skills' && cbData?.startsWith('skill:')) {
    const skill = cbData.slice(6);
    if (upd.callback_query) await send.answerCallback(upd.callback_query.id);
    const selected = (session.state.selectedSkills as string[]) ?? [];
    if (skill !== 'done') {
      const idx = selected.indexOf(skill);
      if (idx >= 0) selected.splice(idx, 1); else selected.push(skill);
      session.state.selectedSkills = selected;
      await db.setSession(chatId, session);
      await sendSkillPicker(send, chatId, l, session.state.role as Role, undefined, selected);
      return true;
    }
    // Create the household + admin member
    const h = await db.createHousehold({
      name: session.state.householdName as string,
      tz: (session.state.tz ?? 'Asia/Dubai') as string,
      lang: (session.state.lang ?? 'ru') as Lang,
    });
    const store = db.store(h);
    const memberId = newMemberId();
    const role = (session.state.role ?? 'adult') as Role;
    await store.saveMember({
      id: memberId, name: session.state.memberName as string, role, lang: h.lang,
      telegramId: chatId, skills: selected,
      busy: [], dailyLimit: role === 'elder' ? 2 : 5, isAdmin: true,
      messageStyle: role === 'elder' ? 'gentle' : 'direct',
    });
    session = { householdId: h.id, memberId, state: {} };
    await db.setSession(chatId, session);
    await send.sendMessage(chatId, TX.created[l](h.name, h.inviteCode, botUsername), [[{ text: TX.readyButton[l], data: 'fam:ready' }]]);
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
      const roster = members.map(m => `${ROLE_EMOJI[m.role]} ${m.name}${m.isAdmin ? ' 👑' : ''}`).join('\n');
      for (const a of admins) {
        await send.sendMessage(a.telegramId!,
          l === 'ru'
            ? `👋 ${newM.name} (${ROLE_LABEL[role].ru}) присоединяется к семье.\n\nСейчас в семье:\n${roster}\n\nЖдём остальных или нажмите «Все в сборе».`
            : `👋 ${newM.name} (${ROLE_LABEL[role].en}) joined the family.\n\nIn the family now:\n${roster}\n\nWaiting for others, or tap "Everyone's here".`,
          [[{ text: TX.readyButton[l], data: 'fam:ready' }]]);
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
