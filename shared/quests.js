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

if (typeof module !== 'undefined') module.exports = { QUESTS };
