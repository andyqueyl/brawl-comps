// Held-out check of the engine: node scripts/check-model.cjs . battles.json [player|random]
// battles.json comes from: DUMP_ONLY=1 DUMP_BATTLES=battles.json node scripts/update.mjs
const fs=require('fs'); const E=require(require('path').resolve(process.argv[2],'js/engine.js'));
const B=JSON.parse(fs.readFileSync(process.argv[3]));
const lg=(w,g)=>Math.log((w+0.5)/(g-w+0.5)), sig=x=>1/(1+Math.exp(-x));
const combos=(ids,k)=>{const o=[];const r=(s,p)=>{if(p.length===k)return o.push(p.join('-'));for(let i=s;i<ids.length;i++)r(i+1,[...p,ids[i]])};r(0,[]);return o};
// deterministic split
const train=[],test=[];
const hash=t=>{let h=2166136261;for(const c of t){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
if(process.argv[4]==='player'){ let mixed=0; for(const b of B){const g=new Set(b[6].map(t=>hash(t)%2)); if(g.size>1){mixed++;continue} (g.has(0)?train:test).push(b)} console.log('player split, dropped mixed',mixed);}
else B.forEach((b,i)=>((i*2654435761>>>0)%10<5?train:test).push(b));
// h per mode from train
const tally={}; for(const [mode,,,teams,win,has] of train){ if(has[0]!==has[1]){const s=has[0]?0:1;(tally[mode]||=[0,0]);tally[mode][0]++;tally[mode][1]+=win===s?1:0}}
const all=Object.values(tally).reduce((a,[g,w])=>[a[0]+g,a[1]+w],[0,0]); const hAll=lg(all[1],all[0]);
const H={}; for(const [m,[g,w]] of Object.entries(tally)) H[m]=(g*lg(w,g)+300*hAll)/(g+300);
function build(method){
  const maps={};
  for(const [mode,map,type,teams,win,has] of train){
    const k=mode+'|'+map; const m=maps[k]||(maps[k]={mode,map,battles:0,ranked:0,brawlers:{},pairs:{},trios:{},raw:{brawlers:{},pairs:{},trios:{}}});
    m.battles++;
    teams.forEach((t,i)=>{const side=has[i]&&has[1-i]?2:has[i]?0:1; if(method==='ON'&&side===0) return;
      const ids=[...new Set(t)].sort((a,b)=>a-b); const w=win===i;
      const add=(f,key)=>{const c=m.raw[f][key]||(m.raw[f][key]=[0,0,0,0,0,0]);c[side*2]++;c[side*2+1]+=w?1:0};
      ids.forEach(id=>add('brawlers',id)); combos(ids,2).forEach(p=>add('pairs',p)); if(ids.length===3) add('trios',ids.join('-'));});
  }
  for(const m of Object.values(maps)){const h=H[m.mode]??hAll; for(const f of ['brawlers','pairs','trios']) for(const [key,[gS,wS,gO,wO,gN,wN]] of Object.entries(m.raw[f])){let w=wN; if(gS) w+=gS*sig(lg(wS,gS)-h); if(gO) w+=gO*sig(lg(wO,gO)+h); m[f][key]=[gS+gO+gN,w];} delete m.raw;}
  return {maps};
}
function evaluate(meta, useTeam){
  const tot=E.modeTotals(meta); const models={}; let ll=0,n=0,acc=0; const pts=[];
  for(const [mode,map,type,teams,win,has] of test){
    const k=mode+'|'+map; if(!meta.maps[k]) continue; const md=models[k]||(models[k]=E.mapModel(meta,k,tot));
    const L=teams.map(t=>useTeam?md.team([...new Set(t)]).L:[...new Set(t)].reduce((s,id)=>s+md.brawler(id).L,0));
    let h=0; if(has[0]&&!has[1]) h=H[mode]??hAll; else if(has[1]&&!has[0]) h=-(H[mode]??hAll);
    pts.push([h,L[0]-L[1],win===0?1:0]);
  }
  const score=a=>{let ll=0,acc=0;for(const [h,d,y] of pts){const p=sig(h+a*d);ll-=y?Math.log(p):Math.log(1-p);acc+=((p>0.5)===(y===1))?1:0}return [ll/pts.length,acc/pts.length]};
  let best=[1,Infinity]; for(let a=0;a<=2.01;a+=0.05){const [l]=score(a); if(l<best[1]) best=[a,l]}
  const [l0,a0]=score(0),[l1,a1]=score(1);
  return `n=${pts.length} | h-only logloss ${l0.toFixed(4)} acc ${(a0*100).toFixed(1)}% | model(a=1) ${l1.toFixed(4)} acc ${(a1*100).toFixed(1)}% | best a=${best[0].toFixed(2)} logloss ${best[1].toFixed(4)}`;
}
console.log('train',train.length,'test',test.length,'h all',(sig(hAll)*100).toFixed(1)+'%');
for(const method of ['SON','ON']){const meta=build(method); console.log(method,'brawler-only:',evaluate(meta,false)); console.log(method,'with pairs/trios:',evaluate(meta,true));}
// Top-ranked trios in train: what do they do in test, against the h-adjusted expectation?
{
  const meta=build('SON'); const tot=E.modeTotals(meta); const sel={};
  for(const k of Object.keys(meta.maps)){const md=E.mapModel(meta,k,tot); for(const t of md.topTeams('trios',5,8)) sel[k+'#'+t.ids.join('-')]={p:t.p,md};}
  let n=0,expW=0,W=0,predSum=0;
  for(const [mode,map,type,teams,win,has] of test){ const k=mode+'|'+map;
    teams.forEach((t,i)=>{const ids=[...new Set(t)].sort((a,b)=>a-b); const s=sel[k+'#'+ids.join('-')]; if(!s) return;
      const other=[...new Set(teams[1-i])]; const Lo=s.md.team(other).L; const L=s.md.team(ids).L;
      let h=0; if(has[i]&&!has[1-i]) h=H[mode]??hAll; else if(has[1-i]&&!has[i]) h=-(H[mode]??hAll);
      n++; W+=win===i?1:0; expW+=sig(h+L-Lo); predSum+=sig(h);});}
  console.log(`top-5 trios per map (train): ${n} test games | actual wins ${(W/n*100).toFixed(1)}% | model expected ${(expW/n*100).toFixed(1)}% | expected from player-skill edge alone ${(predSum/n*100).toFixed(1)}%`);
}
