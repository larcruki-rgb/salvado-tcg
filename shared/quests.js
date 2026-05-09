const QUESTS = [
  {
    id: 'quest_01',
    name: '雑魚軍団を突破せよ',
    description: 'モブキャラ4体が立ちはだかる。蹴散らせ！',
    difficulty: 1,
    player: { life: 2000, mana: 5 },
    cpu: {
      life: 300, mana: 5,
      field: ['kaera', 'jk_a', 'mamachari', 'kyamakiri']
    }
  },
  {
    id: 'quest_04',
    name: '戦闘用外部ユニット スマッシャー',
    description: 'スマッシャーを装備したアンドロイド ユリが立ちはだかる。突破せよ！',
    difficulty: 2,
    player: { life: 1500, mana: 3 },
    cpu: {
      life: 1000, mana: 3,
      field: [{ id: 'yuri', enchantments: ['smasher'] }]
    }
  },
  {
    id: 'quest_02',
    name: '魔王マオリアを討伐せよ',
    description: '寄生体に蝕まれた魔王が立ちはだかる。倒せるか？',
    difficulty: 3,
    player: { life: 1000, mana: 5 },
    cpu: {
      life: 1000, mana: 5,
      field: [{ id: 'maoria', enchantments: ['parasite'] }]
    }
  },
  {
    id: 'quest_03',
    name: 'モルティス軍団を潜り抜けろ',
    description: 'イズナ・マオリア・レイチェンが待ち構える。突破口を見つけろ！',
    difficulty: 3,
    player: { life: 2000, mana: 5 },
    cpu: {
      life: 500, mana: 5,
      field: ['izuna', 'maoria', 'reichen']
    }
  }
];

const BOSS_RUSH_COURSES = [
  {
    id: 'boss_normal',
    name: 'ノーマル',
    difficulty: 2,
    description: '3連戦を勝ち抜け！',
    stages: [
      { name: 'ROUND 1 — 最強賢者と盗賊', cpu: { life: 500, mana: 5, field: ['reichen', 'sagi'] } },
      { name: 'ROUND 2 — 死神とアンドロイド', cpu: { life: 1000, mana: 7, field: ['shinigami', { id: 'yuri', enchantments: ['smasher'] }] } },
      { name: 'ROUND 3 — 魔王と勇者', cpu: { life: 1000, mana: 10, field: ['ark', 'milia'] } }
    ]
  },
  {
    id: 'boss_hard',
    name: 'ハード',
    difficulty: 3,
    description: '強敵3連戦を勝ち抜け！',
    stages: [
      { name: 'ROUND 1 — 暗殺者とドラゴン', cpu: { life: 1000, mana: 5, field: ['azusa', 'asaki', 'lucia'] } },
      { name: 'ROUND 2 — 勇者の血族', cpu: { life: 1000, mana: 7, field: ['daria', 'ark', 'milia'] } },
      { name: 'ROUND 3 — 最強勇者パーティ', cpu: { life: 1000, mana: 10, field: ['maoria', 'tomo', 'izuna', 'miiko'] } }
    ]
  }
];

const PUZZLES = [
  {
    id: 'puzzle_01',
    name: 'はじめての詰め',
    description: 'このターンで相手のLPを0にせよ！',
    player: {
      life: 500, mana: 3,
      field: ['iron_boss', 'kaera'],
      hand: ['super_chat'],
      manaCards: 3
    },
    cpu: {
      life: 200, mana: 0,
      field: ['mamachari']
    },
    turnLimit: 1
  },
  {
    id: 'puzzle_02',
    name: '飛行の抜け道',
    description: 'ブロッカーの壁を飛行で突破せよ！',
    player: {
      life: 300, mana: 5,
      field: [{ id: 'lucia', enchantments: [] }],
      hand: ['rena'],
      manaCards: 5
    },
    cpu: {
      life: 400, mana: 0,
      field: ['iron_boss', 'iron_boss', 'daria']
    },
    turnLimit: 1
  },
  {
    id: 'puzzle_03',
    name: '魔王の血族',
    description: '寄生体に蝕まれた盤面を打ち破れ！',
    player: {
      life: 400, mana: 15,
      field: ['ark', 'jun'],
      hand: ['kikaku_botsu', 'jun'],
      manaCards: 15,
      deck: ['shinigami']
    },
    cpu: {
      life: 500, mana: 10,
      field: [{ id: 'milia', enchantments: ['parasite'] }, 'token_monster', 'token_monster', 'token_monster', 'token_monster', 'token_monster']
    },
    turnLimit: 1
  }
];

if (typeof module !== 'undefined') module.exports = { QUESTS, BOSS_RUSH_COURSES, PUZZLES };
