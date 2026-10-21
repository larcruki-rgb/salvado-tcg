// ランキングの同名(ゲスト同士)に順位順で #n を付ける。実行: node tests/ranking_names.test.js
const path = require('path'); const { numberDuplicateNames } = require(path.join(__dirname, '..', 'server/Ranking.js'));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const r = numberDuplicateNames([{ playerId: 'a', name: 'キジトラ', wins: 9 }, { playerId: 'b', name: 'フカ', wins: 8 }, { playerId: 'c', name: 'キジトラ', wins: 5 }, { playerId: 'd', name: 'キジトラ', wins: 1 }]);
ok(r.map(x => x.name).join('|') === 'キジトラ #1|フカ|キジトラ #2|キジトラ #3', 'R1) 同名は順位順に #1 #2 #3、1人だけの名前はそのまま: ' + r.map(x => x.name).join('|'));
ok(r[0].rawName === 'キジトラ' && r[1].rawName === undefined && r[0].playerId === 'a', 'R2) 元の名前は rawName に残り、他の項目は変わらない');
ok(numberDuplicateNames([]).length === 0, 'R3) 空でも落ちない');
const r2 = numberDuplicateNames([{ name: 'constructor' }, { name: '__proto__' }, { name: 'constructor' }]);
ok(r2.map(x => x.name).join('|') === 'constructor #1|__proto__|constructor #2', 'R4) constructor / __proto__ という名前でも壊れない: ' + r2.map(x => x.name).join('|'));
console.log('RESULT: ' + (fails ? 'FAIL (' + fails + ')' : 'PASS')); process.exit(fails ? 1 : 0);
