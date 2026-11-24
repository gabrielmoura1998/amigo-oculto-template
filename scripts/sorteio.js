// Sorteio do Amigo Oculto 2026: roda no GitHub Actions, nunca no navegador.
// O teste roda com 3+ pessoas (pra experimentar); o oficial exige MIN_PARTICIPANTS.
// Uso: node scripts/sorteio.js <teste|oficial|liberar-numeros> [confirmacao]
// Logs de repo público são públicos: no oficial o log mostra só as checagens.
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const sa = JSON.parse(process.env.FIREBASE_SA || '{}');
if (!sa.project_id) { console.error('Faltou o secret FIREBASE_SA no GitHub.'); process.exit(1); }
initializeApp({ credential: cert(sa) });
const db = getFirestore();

// Precisam bater com as constantes do index.html
const MIN_CIRCLE = 5;
const MIN_PARTICIPANTS = 10; // com 10+, cada um consegue ter 5 no círculo e o sorteio não fica previsível
const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LV = ['Nenhuma', 'Média', 'Muita'];
const fail = m => { console.error('❌ ' + m); process.exit(1); };

// Corrente única passando por todo mundo. lvl(g, r) >= 1 = r está no círculo de g. "Muita" pesa 3x.
function solve(ids, lvl, tries = 400) {
  const n = ids.length;
  if (n < 3) return null;
  for (let t = 0; t < tries; t++) {
    const start = ids[Math.floor(Math.random() * n)], path = [start], used = new Set([start]);
    let steps = 0;
    const go = () => {
      if (++steps > 5000) return false;
      const g = path[path.length - 1];
      if (path.length === n) return lvl(g, start) >= 1;
      const c = ids.filter(r => !used.has(r) && lvl(g, r) >= 1)
        .map(r => ({ r, w: (lvl(g, r) === 2 ? 3 : 1) * Math.random() })).sort((a, b) => b.w - a.w);
      for (const { r } of c) { path.push(r); used.add(r); if (go()) return true; path.pop(); used.delete(r); }
      return false;
    };
    if (go()) return path;
  }
  return null;
}

function checks(order, take, lvl) {
  const ids = order, recv = ids.map(i => take[i]);
  const seen = new Set(); let cycles = 0;
  ids.forEach(i => { if (seen.has(i)) return; cycles++; let j = i; while (!seen.has(j)) { seen.add(j); j = take[j]; } });
  const out = [
    [ids.every(i => take[i] !== undefined), `Todas as ${ids.length} pessoas tiraram alguém`],
    [new Set(recv).size === ids.length && recv.every(r => ids.includes(r)), 'Cada pessoa foi tirada exatamente uma vez'],
    [ids.every(i => take[i] !== i), 'Ninguém tirou a si mesmo'],
    [ids.every(i => take[take[i]] !== i), 'Nenhuma troca direta (A tira B e B tira A)'],
    [cycles === 1, `Uma corrente só, passando por todas as ${ids.length} pessoas`],
  ];
  if (lvl) {
    const lv = ids.map(i => lvl(i, take[i])), m = lv.filter(v => v === 2).length;
    out.push([lv.every(v => v >= 1), `Todo mundo tirou alguém do próprio círculo: ${m} por muita e ${ids.length - m} por média`]);
  }
  return out.map(([ok, txt]) => ({ ok, txt }));
}
const printChecks = cs => cs.forEach(c => console.log(`${c.ok ? '✅' : '❌'} ${c.txt}`));

async function teste() {
  const cfgRef = db.doc('config/app'), cfg = (await cfgRef.get()).data();
  if (cfg.finalLocked) fail('O sorteio oficial já aconteceu.');
  const us = (await db.collection('users').get()).docs.map(d => ({ uid: d.id, ...d.data() }));
  const order = solve(us.map(u => u.uid), () => 1); // teste não usa intimidade
  if (!order) fail('Precisa de pelo menos 3 participantes.');
  const take = {}; order.forEach((g, i) => take[g] = order[(i + 1) % order.length]);
  const name = Object.fromEntries(us.map(u => [u.uid, (u.nome || 'Sem nome').split(' ')[0]]));
  const no = (cfg.testNo || 0) + 1, cs = checks(order, take, null);
  await db.doc('tests/latest').set({ no, at: FieldValue.serverTimestamp(), chain: order.map(id => name[id]), checks: cs });
  await cfgRef.update({ testNo: no });
  console.log(`Teste nº ${no} (público, sem intimidade):`);
  printChecks(cs);
  console.log('Corrente: ' + [...order, order[0]].map(id => name[id]).join(' → '));
}

async function oficial(confirm) {
  if (String(confirm || '').trim().toUpperCase() !== 'OFICIAL') fail('Pra rodar o oficial, digita OFICIAL no campo de confirmação.');
  await db.runTransaction(async tx => {
    const cfgRef = db.doc('config/app'), cfg = (await tx.get(cfgRef)).data();
    if (cfg.finalLocked) fail('O sorteio oficial já aconteceu e está trancado.');
    const us = (await tx.get(db.collection('users'))).docs.map(d => ({ uid: d.id, ...d.data() }));
    const ids = us.map(u => u.uid);
    const R = Object.fromEntries((await tx.get(db.collection('intim'))).docs.map(d => [d.id, d.data().r || {}]));
    const lvl = (g, r) => (R[g] && typeof R[g][r] === 'number') ? R[g][r] : 0; // sem padrão escondido

    if (ids.length < MIN_PARTICIPANTS) fail(`O oficial precisa de pelo menos ${MIN_PARTICIPANTS} participantes cadastrados (hoje: ${ids.length}).`);
    const notReg = (cfg.allowed || []).filter(e => !us.some(u => (u.email || '').toLowerCase() === e));
    if (notReg.length) fail(`Ainda não se cadastraram: ${notReg.join(', ')}`);
    const pend = us.filter(u => {
      const o = ids.filter(x => x !== u.uid);
      return !o.every(x => R[u.uid] && typeof R[u.uid][x] === 'number') || o.filter(x => lvl(u.uid, x) >= 1).length < MIN_CIRCLE;
    });
    if (pend.length) fail(`Ainda faltam terminar a intimidade: ${pend.map(u => (u.nome || u.email).split(' ')[0]).join(', ')}`);

    const order = solve(ids, lvl);
    if (!order) fail('Com as intimidades atuais a corrente não fecha.');
    const take = {}; order.forEach((g, i) => take[g] = order[(i + 1) % order.length]);
    const codes = {}, used = new Set();
    ids.forEach(id => { let k; do { k = Array.from({ length: 3 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join(''); } while (used.has(k)); used.add(k); codes[id] = k; });
    const starter = us.find(u => u.uid === order[0]), cs = checks(order, take, lvl);

    ids.forEach(id => tx.set(db.doc(`results/${id}`), { receiver: take[id], code: codes[id], level: lvl(id, take[id]) }));
    tx.set(db.doc('private/order'), { order });
    tx.set(db.doc('audit/final'), {
      at: FieldValue.serverTimestamp(), starterName: starter.nome || starter.email, checks: cs,
      pairs: ids.map(id => ({ g: codes[id], r: codes[take[id]], lv: LV[lvl(id, take[id])] })).sort((a, b) => a.g < b.g ? -1 : 1),
      chain: order.map(id => codes[id]), testNo: cfg.testNo || 0,
    });
    tx.update(cfgRef, { finalLocked: true, drawAt: FieldValue.serverTimestamp(), starterName: starter.nome || starter.email });
    console.log('🔒 Sorteio oficial feito e trancado.');
    printChecks(cs);
    // Log de repo público é público: aqui só as checagens. Quem abre e os códigos ficam no site, pros admins.
    console.log('Quem abre a corrente e a auditoria por códigos: aba Admin do site.');
  });
}

async function liberar() {
  const cfg = (await db.doc('config/app').get()).data();
  if (!cfg.finalLocked) fail('Primeiro roda o sorteio oficial.');
  const { order } = (await db.doc('private/order').get()).data();
  const b = db.batch();
  order.forEach((id, i) => b.set(db.doc(`positions/${id}`), { pos: i + 1, total: order.length }));
  b.update(db.doc('config/app'), { orderOpen: true });
  await b.commit();
  console.log(`Números liberados pras ${order.length} pessoas.`);
}

const [acao, conf] = process.argv.slice(2);
({ teste, oficial: () => oficial(conf), 'liberar-numeros': liberar }[acao] || (() => fail('Ação inválida: use teste, oficial ou liberar-numeros')))()
  .then(() => process.exit(0)).catch(e => fail(e.message));
