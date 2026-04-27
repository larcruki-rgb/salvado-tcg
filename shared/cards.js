// カードデータベース — game.htmlから抽出
const CARD_DB=[
{id:'maoria',art:'img/maoria.png',artStyle:'object-fit:contain;background:#1a1a2e;',name:'のちの魔王 マオリア',type:'creature',subtype:['人間','勇者','主人公'],cost:7,power:5,toughness:5,abilities:['activated_maoria'],text:'3+T:Pow+300点ダメージ',hero:true,copies:1},
{id:'tomo',art:'img/tomo.png',name:'勇者 トモ',type:'creature',subtype:['人間','勇者','ヒロイン'],cost:8,power:8,toughness:8,abilities:['vigilance','haste'],text:'油断しない,俊足',heroine:true,copies:1},
{id:'izuna',art:'img/izuna.png',name:'魔法使い イズナ',type:'creature',subtype:['人間','魔法使い'],cost:3,power:3,toughness:1,abilities:['flying','activated_izuna'],text:'飛行/【応援2】+T:200点ダメージ',copies:1},
{id:'miiko',art:'img/miiko.png',artStyle:'object-fit:contain;background:#1a1a2e;',name:'僧侶 ミーコ',type:'creature',subtype:['人間','僧侶'],cost:3,power:0,toughness:3,abilities:['regen_miiko'],text:'味方破壊時【応援2】蘇生',copies:2},
{id:'parasite',art:'img/parasite.png',artStyle:'object-fit:contain;background:#1a1a2e;',name:'魔の寄生体',type:'enchantment',subtype:['エンチャント'],cost:4,abilities:['parasite'],text:'+200/+200,【応援1】蘇生,魔物生成,ライフロス',copies:1},
{id:'salvado_cat',art:'img/salvado_cat.png',speed:'sorcery',name:'サルベド猫',type:'support',subtype:['クリエイター','管理者'],cost:5,abilities:['search_creator'],text:'クリエイター3枚サーチ→2枚捨て',copies:1},
{id:'makkinii',art:'img/makkinii.png',speed:'instant',name:'まっきーに',type:'support',subtype:['クリエイター','ディレクター'],cost:5,abilities:['buff_all'],text:'クリエイター2枚捨てで無料/全体+300/+300',copies:1},
{id:'sakamachi',art:'img/sakamachi.png',speed:'sorcery',name:'坂街透',type:'support',subtype:['クリエイター','イラストレーター'],cost:3,abilities:['search_illustrator'],text:'イラストレーター3枚→2枚手札,1枚ゴミ箱',copies:1},
{id:'kaera',name:'パン屋の娘 カエラ',type:'creature',subtype:['人間','一般人'],cost:1,power:1,toughness:1,abilities:['etb_heal'],text:'登場時:ライフ200点回復',copies:2},
{id:'jk_a',name:'一般女子高生A',type:'creature',subtype:['人間','一般人'],cost:2,power:1,toughness:1,abilities:['create_token_jk'],text:'【応援3】:攻撃100 HP100トークン生成',copies:2},
{id:'iron_boss',name:'Aレイスのボス',type:'creature',subtype:['人間','悪'],cost:4,power:2,toughness:3,abilities:['lord_evil'],text:'悪全体+100/+100',copies:1},
{id:'iron_chaser',name:'Aレイスの追手',type:'creature',subtype:['人間','悪'],cost:2,power:1,toughness:2,abilities:['attack_evil_buff'],text:'攻撃時他の悪で+100/+0',copies:2},
{id:'asaki',name:'元掃除屋 アサキ',type:'creature',subtype:['人間','暗殺者','主人公'],cost:5,power:4,toughness:4,abilities:['activated_asaki'],text:'T:相手の手札を見る',hero:true,copies:1},
{id:'azusa',name:'掃除屋 アズサ',type:'creature',subtype:['人間','暗殺者','ヒロイン'],cost:5,power:4,toughness:3,abilities:['activated_azusa'],text:'2+T:相手の手札からランダムに1枚捨てさせる',heroine:true,copies:1},
{id:'hikaru',art:'img/hikaru.png',speed:'sorcery',name:'ひかる',type:'support',subtype:['クリエイター','イラストレーター'],cost:2,abilities:['draw_tap'],text:'2枚ドロー→全タップ',copies:2},
{id:'oyuchi',art:'img/oyuchi.png',speed:'sorcery',name:'おゆち',type:'support',subtype:['クリエイター','イラストレーター'],cost:1,abilities:['draw_illustrator'],text:'1枚ドロー(イラストレーターなら+1)',copies:2},
{id:'nari',art:'img/nari.png',speed:'sorcery',name:'NARI',type:'support',subtype:['クリエイター','イラストレーター'],cost:2,abilities:['look_five'],text:'デッキ上5枚から1枚手札に',copies:1},
{id:'ai_tsubame',art:'img/ai_tsubame.png',speed:'sorcery',name:'愛つばめ',type:'support',subtype:['クリエイター','イラストレーター'],cost:3,abilities:['draw_give'],text:'3枚ドロー→相手が1枚選んで捨て',copies:1},
{id:'ichiko',speed:'instant',name:'いちこ',type:'support',subtype:['クリエイター','声優'],cost:4,abilities:['charm'],text:'4択:300点/500点回復/+200攻/相手-100攻',copies:2},
{id:'douga_sakujo',speed:'instant',name:'動画削除',type:'support',subtype:['規約'],cost:3,abilities:['counterspell'],text:'発動された効果1つを無効にする',copies:2},
{id:'shueki_teishi',speed:'instant',name:'収益停止',type:'support',subtype:['規約'],cost:4,abilities:['tap_opp_mana'],text:'相手の視聴者全タップ',copies:1},
{id:'channel_sakujo',speed:'sorcery',name:'チャンネル削除',type:'support',subtype:['規約'],cost:6,abilities:['board_wipe'],text:'全場破壊+手札全捨て+7枚引き直し',copies:1},
{id:'shinigami',art:'img/shinigami.png',artStyle:'object-position:center 15%;',name:'死神少女',type:'creature',subtype:['人間','死神'],cost:5,power:2,toughness:3,abilities:['activated_shinigami'],text:'T+LP300:確定除去(蘇生不可)/T+LP200:ランダムハンデス/T+LP500:打ち消し',copies:1},
{id:'jun',art:'img/jun.png',artStyle:'object-fit:contain;background:#1a1a2e;',name:'ジュン',type:'creature',subtype:['人間','主人公'],cost:2,power:1,toughness:2,abilities:['etb_search_shinigami'],text:'登場時:死神少女サーチ',hero:true,copies:1},
{id:'mamachari',name:'ママチャリ暴走族',type:'creature',subtype:['人間','悪'],cost:2,power:2,toughness:1,abilities:['haste'],text:'俊足',copies:2},
{id:'kyamakiri',art:'img/kyamakiri.png',name:'キャマキリ',type:'creature',subtype:['昆虫'],cost:1,power:1,toughness:1,abilities:['attack_power_buff'],text:'攻撃時+200/+0',copies:2},
{id:'milia',art:'img/milia.png',name:'勇者の血族 ミリア',type:'creature',subtype:['人間','勇者','ヒロイン'],cost:4,power:3,toughness:3,abilities:['lord_ally'],text:'他の味方+100/+100',heroine:true,copies:1},
{id:'daria',art:'img/daria.png',artStyle:'object-position:20% 15%;',name:'勇者の兄 ダリア',type:'creature',subtype:['人間','一般人'],cost:3,power:0,toughness:5,abilities:['cannot_attack','block_immune'],text:'攻撃不可/ブロック時ダメージ無効',copies:2},
{id:'douga_henshuu',speed:'sorcery',name:'動画編集',type:'support',subtype:['規約'],cost:2,abilities:['debuff_target'],text:'対象-300/-300(ターン終了まで)',copies:2},
{id:'super_chat',speed:'instant',name:'スーパーチャット',type:'support',subtype:['規約'],cost:1,abilities:['buff_target'],text:'味方+300/+300(ターン終了まで)',copies:2},
{id:'kikaku_botsu',speed:'sorcery',name:'企画ボツ',type:'support',subtype:['規約'],cost:4,abilities:['destroy_target'],text:'投稿キャラ1体破壊',copies:2},
{id:'seitokaichou',art:'img/seitokaichou.png',name:'生徒会長ヒロイン',type:'creature',subtype:['人間'],cost:2,power:1,toughness:1,abilities:['vigilance','etb_draw'],text:'油断しない/登場時:1枚ドロー',copies:2},
{id:'osananajimi',art:'img/osananajimi.png?v=2',artStyle:'object-position:60% center;',name:'幼馴染ヒロイン',type:'creature',subtype:['人間'],cost:2,power:1,toughness:1,abilities:['etb_search_hero'],text:'登場時:主人公サーチ',copies:2},
{id:'onna_joushi',art:'img/onna_joushi.png',name:'女上司ヒロイン',type:'creature',subtype:['人間'],cost:2,power:1,toughness:1,abilities:['vigilance','etb_peek_top'],text:'油断しない/登場時:デッキトップ確認→シャッフル可',copies:2},
{id:'shiko_touchou',art:'img/shiko_touchou.png',speed:'sorcery',name:'思考盗聴された！',type:'support',subtype:['サポート'],cost:2,abilities:['peek_hand'],text:'相手の手札を見る',copies:1},
{id:'seishun_kiben',art:'img/seishun_kiben.png',speed:'sorcery',name:'青春詭弁',type:'support',subtype:['クリエイター','ライター'],cost:5,abilities:['free_summon_hero'],text:'手札の主人公/ヒロインを無料投稿',copies:1},
{id:'kanwa_kyuudai',art:'img/kanwa_kyuudai.png',artStyle:'object-fit:contain;background:#1a1a2e;',speed:'instant',name:'閑話休題',type:'support',subtype:['サポート'],cost:5,abilities:['all_tap'],text:'割り込み/全投稿キャラタップ',copies:2},
{id:'salvado_cat_yarakashi',speed:'sorcery',name:'サルベド猫のやらかし',type:'support',subtype:['クリエイター','管理者'],cost:6,abilities:['destroy_no_regen'],text:'打ち消し不可/確定除去(蘇生不可)',copies:1},
{id:'ark',art:'img/ark.png',name:'魔王の血族 アーク',type:'creature',subtype:['人間','魔王','主人公'],cost:8,power:5,toughness:5,abilities:['debuff_opp'],text:'相手全体-100/-100',hero:true,copies:1},
{id:'99wari',speed:'sorcery',name:'99割間違いない',type:'support',subtype:['規約'],cost:9,abilities:['99wari'],text:'LP900支払い/相手全投稿キャラ破壊+相手手札全捨て',copies:1},
{id:'imouto',art:'img/imouto.png',name:'妹系ヒロイン',type:'creature',subtype:['人間'],cost:1,power:1,toughness:1,abilities:['haste'],text:'俊足',copies:2},
{id:'katorina',art:'img/katorina.png',speed:'sorcery',name:'かとりーな',type:'support',subtype:['クリエイター','イラストレーター'],cost:4,abilities:['create_token_v'],text:'Vトークン2体生成',copies:2},
{id:'akapo',art:'img/akapo.png',speed:'instant',name:'あかぽ',type:'support',subtype:['クリエイター','イラストレーター'],cost:2,abilities:['buff_power_target'],text:'割り込み/味方1体+500/+0',copies:2},
{id:'komi',speed:'sorcery',name:'komi',type:'support',subtype:['クリエイター','イラストレーター'],cost:1,abilities:['heal_all'],text:'味方全投稿キャラのダメージ全回復',copies:2},
{id:'ki_no_sei',name:'木の精',type:'enchantment',subtype:['エンチャント'],cost:2,abilities:['block_immune'],text:'ブロック時ダメージ無効',copies:2},
{id:'nanase',art:'img/nanase.png',speed:'sorcery',name:'ななせ',type:'support',subtype:['クリエイター','イラストレーター'],cost:2,abilities:['draw_to'],text:'手札が4枚になるようにドロー',copies:2},
{id:'mensetsu_kan',art:'img/mensetsu_kan.png',name:'面接官ヒロイン',type:'creature',subtype:['人間'],cost:3,power:1,toughness:2,abilities:['etb_destroy_hero'],text:'登場時:相手の主人公1体破壊',flavor:'私をフった理由を答えなさい',copies:2},
{id:'reichen',art:'img/reichen.png',name:'賢者 レイチェン',type:'creature',subtype:['人間','賢者','ヒロイン'],cost:4,power:2,toughness:3,abilities:['activated_reichen_heal','activated_reichen_dmg'],text:'【応援1】味方1体全回復/【応援4】+T:相手1体に500ダメージ',heroine:true,copies:1},
{id:'sagi',art:'img/sagi.png',name:'盗賊 サギ',type:'creature',subtype:['人間','盗賊','主人公'],cost:4,power:2,toughness:2,abilities:['haste','vigilance','activated_sagi_counter','activated_sagi_recover'],text:'俊足,油断しない/【応援3】+T:打ち消し/【応援4】墓地回収',hero:true,copies:1},
{id:'dansou',name:'男装系ヒロイン',type:'creature',subtype:['人間'],cost:3,power:1,toughness:3,abilities:['activated_dansou_buff'],text:'【応援3】:攻撃+200(重ねがけ可)',copies:2},
];

const TOKEN_MONSTER={id:'token_monster',name:'魔物',type:'creature',subtype:['魔物'],cost:0,power:1,toughness:1,abilities:[],text:'トークン',isToken:true};
const TOKEN_JK={id:'token_jk',name:'女子高生',type:'creature',subtype:['人間','一般人'],cost:0,power:1,toughness:1,abilities:[],text:'トークン',isToken:true};
const TOKEN_V={id:'token_v',name:'V',type:'creature',subtype:['V'],cost:0,power:2,toughness:2,abilities:[],text:'トークン',isToken:true};

function makeCard(c){return{...c,uid:Math.random().toString(36).substr(2,9),damage:0,summonSick:true,tapped:false,enchantments:[],tempBuff:{power:0,toughness:0}};}

function buildDeck(deckDef){
  let deck=[];
  if(deckDef&&Array.isArray(deckDef)){
    deckDef.forEach(d=>{let c=CARD_DB.find(x=>x.id===d.id);if(c){for(let i=0;i<d.count;i++)deck.push(makeCard(c));}});
  }else{
    CARD_DB.forEach(c=>{for(let i=0;i<c.copies;i++)deck.push(makeCard(c));});
  }
  for(let i=deck.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  return deck;
}

// Node.js用エクスポート（ブラウザでは無視される）
if(typeof module!=='undefined'&&module.exports){
  module.exports={CARD_DB,TOKEN_MONSTER,TOKEN_JK,TOKEN_V,makeCard,buildDeck};
}
