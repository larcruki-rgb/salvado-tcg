// カードデータベース — game.htmlから抽出
const CARD_DB=[
{id:'maoria',art:'img/maoria.png',name:'のちの魔王 マオリア',type:'creature',subtype:['人間','勇者','主人公'],cost:7,power:500,toughness:500,abilities:['activated_maoria_flying','activated_maoria'],text:'【応援4】:ターン終了時まで飛行/【応援3】+T:ATK+300点ダメージ',hero:true,copies:1},
{id:'tomo',art:'img/tomo.png',artStyle:'object-position:center 30%;',name:'勇者 トモ',type:'creature',subtype:['人間','勇者','ヒロイン'],cost:8,power:800,toughness:800,abilities:['vigilance','haste'],text:'油断しない,俊足',heroine:true,copies:1},
{id:'izuna',art:'img/izuna.png',name:'魔法使い イズナ',type:'creature',subtype:['人間','魔法使い'],cost:3,power:300,toughness:100,abilities:['flying','activated_izuna'],text:'飛行/【応援2】+T:200点ダメージ',copies:1},
{id:'miiko',art:'img/miiko.png',name:'僧侶 ミーコ',type:'creature',subtype:['人間','僧侶'],cost:3,power:0,toughness:300,abilities:['regen_miiko'],text:'味方破壊時【応援2】蘇生',copies:2},
{id:'parasite',art:'img/parasite.png',name:'魔の寄生体',type:'enchantment',subtype:['エンチャント'],cost:4,abilities:['parasite'],text:'+200/+200,【応援1】蘇生,魔物生成,ライフロス',copies:1},
{id:'salvado_cat',art:'img/salvado_cat.png',speed:'sorcery',name:'サルベド猫',type:'support',subtype:['クリエイター','管理者'],cost:5,abilities:['search_creator'],text:'打ち消し不可/クリエイター3枚サーチ→1枚捨て',copies:1},
{id:'makkinii',art:'img/makkinii.png',speed:'instant',name:'まっきーに',type:'support',subtype:['クリエイター','ディレクター'],cost:5,abilities:['buff_all'],text:'クリエイター2枚捨てで無料/全体+300/+300',copies:1},
{id:'sakamachi',art:'img/sakamachi.png',speed:'sorcery',name:'坂街透',type:'support',subtype:['クリエイター','イラストレーター'],cost:3,abilities:['search_illustrator'],text:'イラストレーター3枚→2枚手札,1枚ゴミ箱',copies:1},
{id:'kaera',name:'パン屋の娘 カエラ',type:'creature',subtype:['人間','一般人'],cost:1,power:100,toughness:100,abilities:['etb_heal'],text:'登場時:ライフ200点回復',copies:2},
{id:'jk_a',art:'img/jk.png',name:'一般女子高生A',type:'creature',subtype:['人間','一般人'],cost:2,power:100,toughness:100,abilities:['create_token_jk'],text:'【応援3】:攻撃100 HP100トークン生成',copies:2},
{id:'iron_boss',name:'Aレイスのボス',type:'creature',subtype:['人間','悪'],cost:4,power:200,toughness:300,abilities:['lord_evil'],text:'悪全体+100/+100',copies:1},
{id:'iron_chaser',name:'Aレイスの追手',type:'creature',subtype:['人間','悪'],cost:2,power:100,toughness:200,abilities:['attack_evil_buff'],text:'攻撃時他の悪で+100/+0',copies:2},
{id:'asaki',name:'元掃除屋 アサキ',type:'creature',subtype:['人間','暗殺者','主人公'],cost:5,power:400,toughness:400,abilities:['vigilance','activated_asaki'],text:'油断しない/T:相手の手札を見る',hero:true,copies:1},
{id:'azusa',name:'掃除屋 アズサ',type:'creature',subtype:['人間','暗殺者','ヒロイン'],cost:5,power:400,toughness:300,abilities:['activated_azusa'],text:'2+T:相手の手札からランダムに1枚捨てさせる',heroine:true,copies:1},
{id:'hikaru',art:'img/hikaru.png',speed:'sorcery',name:'ひかる',type:'support',subtype:['クリエイター','イラストレーター'],cost:2,abilities:['draw_tap'],text:'2枚ドロー→全タップ',copies:2},
{id:'oyuchi',art:'img/oyuchi.png',speed:'sorcery',name:'おゆち',type:'support',subtype:['クリエイター','イラストレーター'],cost:1,abilities:['draw_illustrator'],text:'1枚ドロー(イラストレーターなら+1)',copies:2},
{id:'nari',art:'img/nari.png',speed:'sorcery',name:'NARI',type:'support',subtype:['クリエイター','イラストレーター'],cost:2,abilities:['look_five'],text:'デッキ上5枚から1枚手札に',copies:1},
{id:'ai_tsubame',art:'img/ai_tsubame.png',speed:'sorcery',name:'愛つばめ',type:'support',subtype:['クリエイター','イラストレーター'],cost:3,abilities:['draw_give'],text:'3枚ドロー→相手が1枚選んで捨て',flavor:'ハッハッハッハッ　へっへっへっへっ　ワンッ！',copies:1},
{id:'ichiko',art:'img/ichiko.png',speed:'instant',name:'いちこ',type:'support',subtype:['クリエイター','声優'],cost:4,abilities:['charm'],text:'4択:300点/500点回復/+200攻/相手-100攻',copies:2},
{id:'douga_sakujo',art:'img/douga_sakujo.jpg',speed:'instant',name:'動画削除',type:'support',subtype:['規約'],cost:3,abilities:['counterspell'],text:'発動された効果1つを打ち消す',copies:2},
{id:'shueki_teishi',art:'img/shueki_teishi.jpg',speed:'instant',name:'収益停止',type:'support',subtype:['規約'],cost:4,abilities:['tap_opp_mana'],text:'相手の視聴者全タップ',copies:1},
{id:'channel_sakujo',art:'img/channel_sakujo.jpg',speed:'sorcery',name:'チャンネル削除',type:'support',subtype:['規約'],cost:6,abilities:['board_wipe'],text:'全場破壊+手札全捨て+7枚引き直し',copies:1},
{id:'shinigami',art:'img/shinigami.png',artStyle:'object-position:center 15%;',name:'死神少女',type:'creature',subtype:['人間','死神'],cost:5,power:200,toughness:300,abilities:['activated_shinigami'],text:'T+LP300:確定除去(蘇生不可)/T+LP200:ランダムハンデス/T+LP500:打ち消し',copies:1},
{id:'jun',art:'img/jun.png',artStyle:'object-fit:contain;background:#1a1a2e;',name:'ジュン',type:'creature',subtype:['人間','主人公'],cost:2,power:100,toughness:200,abilities:['etb_search_shinigami'],text:'登場時:死神少女サーチ',hero:true,copies:1},
{id:'mamachari',art:'img/mamachari.png',name:'ママチャリ暴走族',type:'creature',subtype:['人間','悪'],cost:2,power:200,toughness:100,abilities:['haste'],text:'俊足',copies:2},
{id:'kyamakiri',art:'img/kyamakiri.png',name:'キャマキリ',type:'creature',subtype:['昆虫'],cost:1,power:100,toughness:100,abilities:['attack_power_buff'],text:'攻撃時+200/+0',copies:2},
{id:'milia',art:'img/milia.png',name:'勇者の血族 ミリア',type:'creature',subtype:['人間','勇者','ヒロイン'],cost:4,power:300,toughness:300,abilities:['lord_ally'],text:'他の味方+100/+100',heroine:true,copies:1},
{id:'daria',art:'img/daria.png',artStyle:'object-position:20% 15%;',name:'勇者の兄 ダリア',type:'creature',subtype:['人間','一般人'],cost:3,power:0,toughness:500,abilities:['cannot_attack','block_immune'],text:'攻撃不可/ブロック時ダメージ無効',copies:2},
{id:'douga_henshuu',art:'img/douga_henshuu.jpg',speed:'sorcery',name:'動画編集',type:'support',subtype:['規約'],cost:2,abilities:['debuff_target'],text:'対象-300/-300(ターン終了まで)',copies:2},
{id:'super_chat',art:'img/super_chat.jpg',speed:'instant',name:'投げ銭',type:'support',subtype:['規約'],cost:1,abilities:['buff_target'],text:'味方+300/+300(ターン終了まで)',copies:2},
{id:'kikaku_botsu',art:'img/kikaku_botsu.jpg',speed:'sorcery',name:'企画ボツ',type:'support',subtype:['規約'],cost:4,abilities:['destroy_target'],text:'投稿キャラ1体破壊',copies:2},
{id:'seitokaichou',art:'img/seitokaichou.png',name:'生徒会長ヒロイン',type:'creature',subtype:['人間'],cost:2,power:100,toughness:100,abilities:['vigilance','etb_draw'],text:'油断しない/登場時:1枚ドロー',copies:2},
{id:'osananajimi',art:'img/osananajimi.png?v=2',artStyle:'object-position:60% center;',name:'幼馴染ヒロイン',type:'creature',subtype:['人間'],cost:2,power:100,toughness:100,abilities:['etb_search_hero'],text:'登場時:主人公サーチ',copies:2},
{id:'kanaria',art:'img/kanaria.png',name:'アイドル カナリア',type:'creature',subtype:['人間','ヒロイン'],cost:2,power:100,toughness:100,abilities:['activated_kanaria_mana'],text:'【応援3】+T:デッキトップを視聴者に追加',flavor:'アイドル辞めて烏丸さんと結婚しますっ！',heroine:true,copies:2},
{id:'onna_joushi',art:'img/onna_joushi.png',name:'女上司ヒロイン',type:'creature',subtype:['人間'],cost:2,power:100,toughness:100,abilities:['vigilance','etb_peek_top'],text:'油断しない/登場時:デッキトップ確認→シャッフル可',copies:2},
{id:'shiko_touchou',art:'img/shiko_touchou.png',speed:'sorcery',name:'思考盗聴された！',type:'support',subtype:['サポート'],cost:0,abilities:['peek_hand'],text:'相手の手札を見る',copies:1},
{id:'seishun_kiben',art:'img/seishun_kiben.png',speed:'instant',name:'青春詭弁',type:'support',subtype:['クリエイター','ライター'],cost:5,abilities:['free_summon_hero'],text:'割り込み/手札の主人公/ヒロインを無料投稿',copies:1},
{id:'kanwa_kyuudai',art:'img/kanwa_kyuudai.png',artStyle:'object-position:center 80%;',speed:'instant',name:'閑話休題',type:'support',subtype:['サポート'],cost:5,abilities:['all_tap'],text:'割り込み/全投稿キャラタップ',copies:2},
{id:'salvado_cat_yarakashi',art:'img/salvado_cat_yarakashi.jpg',speed:'sorcery',name:'サルベド猫のやらかし',type:'support',subtype:['クリエイター','管理者'],cost:6,abilities:['destroy_no_regen'],text:'打ち消し不可/確定除去(蘇生不可)',copies:1},
{id:'ark',art:'img/ark.png',artStyle:'object-position:center 30%;',name:'魔王の血族 アーク',type:'creature',subtype:['人間','魔王','主人公'],cost:8,power:500,toughness:500,abilities:['debuff_opp'],text:'相手全体-100/-100',hero:true,copies:1},
{id:'99wari',art:'img/99wari.png',speed:'sorcery',name:'99割間違いない',type:'support',subtype:['サポート'],cost:9,abilities:['99wari'],text:'LP900支払い/相手全投稿キャラ破壊+相手手札全捨て',copies:1},
{id:'imouto',art:'img/imouto.png',name:'妹系ヒロイン',type:'creature',subtype:['人間'],cost:1,power:100,toughness:100,abilities:['haste'],text:'俊足',copies:2},
{id:'katorina',art:'img/katorina.png',speed:'sorcery',name:'かとりーな',type:'support',subtype:['クリエイター','イラストレーター'],cost:4,abilities:['create_token_v'],text:'Vトークン2体生成',flavor:'おつりーな、ごきげんよう！ばいばーい！',copies:2},
{id:'akapo',art:'img/akapo.jpg',speed:'instant',name:'あかぽ',type:'support',subtype:['クリエイター','イラストレーター'],cost:2,abilities:['buff_power_target'],text:'割り込み/味方1体+500/+0',copies:2},
{id:'komi',art:'img/komi.png',speed:'instant',name:'komi',type:'support',subtype:['クリエイター','イラストレーター'],cost:1,abilities:['heal_all'],text:'割り込み/味方全投稿キャラのダメージ全回復/LP300回復',flavor:'肉まん食べたい',copies:2},
{id:'ki_no_sei',art:'img/ki_no_sei.png',name:'木の精',type:'enchantment',subtype:['エンチャント'],cost:2,abilities:['block_immune'],text:'ブロック時ダメージ無効',copies:2},
{id:'nanase',art:'img/nanase.png',speed:'sorcery',name:'ななせ',type:'support',subtype:['クリエイター','イラストレーター'],cost:2,abilities:['draw_to'],text:'手札が4枚になるようにドロー',copies:2},
{id:'mensetsu_kan',art:'img/mensetsu_kan.png',name:'面接官ヒロイン',type:'creature',subtype:['人間'],cost:3,power:100,toughness:200,abilities:['etb_destroy_hero'],text:'登場時:相手の主人公1体破壊',flavor:'私をフった理由を答えなさい',copies:2},
{id:'reichen',art:'img/reichen.png',artStyle:'object-position:center 30%;',name:'賢者 レイチェン',type:'creature',subtype:['人間','賢者','ヒロイン'],cost:4,power:200,toughness:300,abilities:['activated_reichen_heal','activated_reichen_dmg'],text:'【応援1】味方1体全回復/【応援4】+T:相手1体に500ダメージ',heroine:true,copies:1},
{id:'sagi',art:'img/sagi.png',artStyle:'object-position:center 30%;',name:'盗賊 サギ',type:'creature',subtype:['人間','盗賊','主人公'],cost:4,power:200,toughness:200,abilities:['haste','vigilance','activated_sagi_counter','activated_sagi_recover'],text:'俊足,油断しない/【応援3】+T+手札1枚:打ち消し/【応援4】墓地回収',hero:true,copies:1},
{id:'gomo',art:'img/gomo.png',speed:'sorcery',name:'ごも',type:'support',subtype:['クリエイター','イラストレーター'],cost:4,abilities:['search_heroine'],text:'ヒロイン2枚サーチ',copies:2},
{id:'dansou',art:'img/dansou.png',name:'男装系ヒロイン',type:'creature',subtype:['人間'],cost:3,power:100,toughness:300,abilities:['activated_dansou_buff'],text:'【応援3】:攻撃+200',flavor:'まぁ僕は女だけどね？',copies:2},
{id:'alminium',art:'img/alminium.png',name:'頭にアルミホイルを巻く',type:'enchantment',subtype:['エンチャント'],cost:4,abilities:['untargetable'],text:'効果の対象にならない',flavor:'これで電波は遮断できる……！',copies:2},
{id:'healthy_sleep',art:'img/healthy_sleep.png',name:'夜しか眠れない健康的な生活',type:'enchantment',subtype:['エンチャント'],cost:1,abilities:['healthy_sleep'],text:'HP+300',flavor:'すごく健康的だ…',copies:2},
{id:'yashiro',art:'img/yashiro.png',speed:'sorcery',name:'山岩ヤシロ',type:'support',subtype:['クリエイター','イラストレーター'],cost:4,abilities:['draw_life'],text:'LP500支払い/3枚ドロー',copies:2},
{id:'yuri',art:'img/yuri.png',name:'アンドロイド ユリ',type:'creature',subtype:['人間','アンドロイド'],cost:3,power:200,toughness:200,abilities:['enchant_boost'],text:'エンチャント1つにつき+100/+100',flavor:'ほら見てください。手首の関節を回転させられるんです',heroine:true,copies:1},
{id:'smasher',art:'img/smasher.png',name:'戦術兵器スマッシャー',type:'enchantment',subtype:['エンチャント'],cost:3,abilities:['smasher'],text:'+100/+100,俊足/ユリ装備時:+200/+200,俊足,飛行',flavor:'私専用に作られた戦闘用外部ユニット――識別名はスマッシャー',copies:1},
{id:'douga_fukugen',art:'img/douga_fukugen.png',speed:'instant',name:'動画復元',type:'support',subtype:['規約'],cost:5,abilities:['grave_play'],text:'割り込み/ゴミ箱から投稿キャラ1体無料投稿',copies:2},
{id:'impression_seigen',art:'img/impression_seigen.jpg',speed:'instant',name:'インプレッション制限',type:'support',subtype:['規約'],cost:7,abilities:['debuff_all_500'],text:'割り込み/全キャラ-500/-500',flavor:'そういえばしばらくおすすめ欄で見てないな…',copies:2},
{id:'rena',art:'img/rena.png',artStyle:'object-position:center 15%;',name:'地縛霊 レナ',type:'enchantment',subtype:['エンチャント'],cost:3,abilities:['rena_flying','rena_regen'],text:'飛行/【応援3】蘇生',copies:2},
{id:'suisosui',art:'img/suisosui.png',name:'水素水でナンパする男',type:'creature',subtype:['人間','一般人'],cost:2,power:100,toughness:100,abilities:['etb_bounce_heroine'],text:'登場時:全ヒロインを手札に戻す',flavor:'水素水の美味しいお店行かない？',copies:2},
// ---- 2026-10 追加(クエスト報酬)。copies を書かない＝既定デッキ・CPUの山札(buildDeck(null))に入らない ----
{id:'zeratine',art:'img/zeratine.png',artStyle:'object-position:center 20%;',name:'大食冠 ゼラチネ',type:'creature',subtype:['魔王','13魔王','ヒロイン'],cost:6,power:300,toughness:300,abilities:['activated_zeratine_split','activated_zeratine_eat'],text:'【分裂】応援3+T+自身を生贄:残りHP÷100体のゼラチネ子供(100/100)を出す(最大10体)/【捕食】T+味方1体を生贄:その元の攻撃・HP分 永続強化',flavor:'私はスライムだぞ？',heroine:true,acquire:'quest',deckMax:2},
{id:'lead',art:'img/lead.png',artStyle:'object-position:center 30%;',name:'店主 リード',type:'creature',subtype:['料理人','主人公'],cost:2,power:100,toughness:100,abilities:['activated_lead_search'],text:'【応援3】+T:山札からキャラをランダムに1枚手札に',flavor:'はいどうぞ。サンドイッチだ',hero:true,acquire:'quest',deckMax:2},
{id:'daisuke_dare',art:'img/daisuke_dare.png',artStyle:'object-position:62% center;',speed:'instant',name:'ダイスケ誰その男',type:'support',subtype:['サポート'],cost:2,abilities:['transform_heroes'],text:'割り込み/場の全ての主人公をダイスケ(100/100)に変える',acquire:'quest',deckMax:4},
{id:'lucia',art:'img/lucia.png',artStyle:'object-position:center 30%;',name:'ドラゴン娘 ルシア',type:'creature',subtype:['人間','ドラゴン'],cost:4,power:200,toughness:200,abilities:['activated_lucia_dragon','activated_lucia_breath'],text:'【応援5】:+300/+300飛行/【応援5】+T:自身以外全体200ダメージ',flavor:'なあ、アルス。こいつ食べていい？',heroine:true,copies:2},
];

// デッキに入れられる上限枚数。サーバーの検証(server/deckValidation.js)とクライアントのデッキ編集で同じ値を使う。
// copies(既定デッキに入れる枚数)とは別物。新しいカードは定義に deckMax を直接書く
const DECK_MAX={
  '99wari':1,
  kanaria:2,alminium:2,suisosui:2,maoria:2,tomo:2,asaki:2,azusa:2,shinigami:2,jun:2,ark:2,milia:2,reichen:2,sagi:2,yuri:2,smasher:2,lucia:2,makkinii:2,nari:2,ai_tsubame:2,salvado_cat_yarakashi:2,channel_sakujo:2,impression_seigen:2,
  seitokaichou:4,osananajimi:4,onna_joushi:4,imouto:4,mensetsu_kan:4,dansou:4,ki_no_sei:4,healthy_sleep:4,jk_a:4,mamachari:4,kyamakiri:4,shiko_touchou:4,kanwa_kyuudai:4,izuna:4,miiko:4,parasite:4,kaera:4,iron_chaser:4,iron_boss:4,daria:4,rena:4,salvado_cat:4,sakamachi:4,hikaru:4,oyuchi:4,gomo:4,katorina:4,nanase:4,yashiro:4,akapo:4,komi:4,ichiko:4,seishun_kiben:4,douga_sakujo:4,shueki_teishi:4,kikaku_botsu:4,douga_henshuu:4,super_chat:4,douga_fukugen:4,
};
CARD_DB.forEach(c=>{ if(c.deckMax===undefined) c.deckMax=DECK_MAX[c.id]; });

const TOKEN_MONSTER={id:'token_monster',name:'魔物',type:'creature',subtype:['魔物'],cost:0,power:100,toughness:100,abilities:[],text:'トークン',isToken:true};
const TOKEN_JK={id:'token_jk',name:'女子高生',type:'creature',subtype:['人間','一般人'],cost:0,power:100,toughness:100,abilities:[],text:'トークン',isToken:true};
const TOKEN_V={id:'token_v',name:'V',type:'creature',subtype:['V'],cost:0,power:200,toughness:200,abilities:[],text:'トークン',isToken:true};
const TOKEN_ZERATINE_CHILD={id:'token_zeratine_child',art:'img/token_zeratine_child.png',artStyle:'object-position:35% 25%;',name:'ゼラチネ子供',type:'creature',subtype:['スライム'],cost:0,power:100,toughness:100,abilities:[],text:'トークン',isToken:true};
const TOKEN_DAISUKE={id:'token_daisuke',art:'img/token_daisuke.png',artStyle:'object-position:center 30%;',name:'ダイスケ',type:'creature',subtype:['人間'],cost:0,power:100,toughness:100,abilities:[],text:'トークン',isToken:true};

// カード固有番号(uid)の採番はここ1か所。乱数9桁+通し番号で、同じ番号は二度と出ない。
// 場に入り直す時(GameState._enterField)もこれで振り直す(戻ってきたカードは別物として扱う)
var _uidSeq=0;
function newUid(){_uidSeq++;return Math.random().toString(36).substr(2,9)+_uidSeq.toString(36);}

function makeCard(c){return{...c,abilities:[...(c.abilities||[])],subtype:[...(c.subtype||[])],uid:newUid(),damage:0,summonSick:true,tapped:false,enchantments:[],counters:[],tempBuff:{power:0,toughness:0}};}

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

// 初期デッキ(60枚)。デッキを一度も編集していない人が使う。どれを使うかはサーバーの設定 starter_deck(既定 fantasy)で、月ごとに差し替える。
// 以前は未指定のデッキ＝全カード98枚(buildDeck のフォールバック)で、初めての人が98枚デッキで戦っていた。クライアントの THEME_DECKS と同じ内容
const STARTER_DECKS={
  lovecome:[{id:'seitokaichou',count:3},{id:'osananajimi',count:3},{id:'onna_joushi',count:3},{id:'imouto',count:3},{id:'mensetsu_kan',count:3},{id:'dansou',count:3},{id:'jk_a',count:2},{id:'mamachari',count:2},{id:'kyamakiri',count:2},{id:'ki_no_sei',count:2},{id:'alminium',count:2},{id:'kanwa_kyuudai',count:2},{id:'shiko_touchou',count:1},{id:'99wari',count:1},{id:'healthy_sleep',count:2},{id:'milia',count:2},{id:'reichen',count:2},{id:'izuna',count:2},{id:'ark',count:1},{id:'maoria',count:1},{id:'sagi',count:1},{id:'tomo',count:1},{id:'oyuchi',count:2},{id:'nanase',count:2},{id:'komi',count:1},{id:'akapo',count:1},{id:'gomo',count:2},{id:'super_chat',count:2},{id:'kikaku_botsu',count:2},{id:'katorina',count:2},{id:'kanaria',count:2}],
  fantasy:[{id:'maoria',count:2},{id:'tomo',count:2},{id:'izuna',count:2},{id:'miiko',count:2},{id:'parasite',count:1},{id:'asaki',count:2},{id:'azusa',count:2},{id:'kaera',count:2},{id:'iron_chaser',count:2},{id:'iron_boss',count:1},{id:'shinigami',count:2},{id:'jun',count:2},{id:'ark',count:2},{id:'milia',count:2},{id:'daria',count:2},{id:'reichen',count:2},{id:'sagi',count:2},{id:'mamachari',count:2},{id:'yuri',count:1},{id:'smasher',count:1},{id:'lucia',count:2},{id:'rena',count:1},{id:'seitokaichou',count:2},{id:'osananajimi',count:2},{id:'imouto',count:2},{id:'hikaru',count:2},{id:'oyuchi',count:2},{id:'nanase',count:2},{id:'komi',count:2},{id:'akapo',count:2},{id:'gomo',count:1},{id:'kikaku_botsu',count:2},{id:'super_chat',count:2}],
  creator:[{id:'salvado_cat',count:1},{id:'makkinii',count:1},{id:'akapo',count:2},{id:'nanase',count:2},{id:'gomo',count:2},{id:'komi',count:2},{id:'yashiro',count:2},{id:'katorina',count:2},{id:'sakamachi',count:1},{id:'hikaru',count:2},{id:'oyuchi',count:2},{id:'nari',count:1},{id:'ai_tsubame',count:1},{id:'ichiko',count:1},{id:'seishun_kiben',count:1},{id:'channel_sakujo',count:1},{id:'salvado_cat_yarakashi',count:1},{id:'douga_sakujo',count:2},{id:'shueki_teishi',count:1},{id:'kikaku_botsu',count:2},{id:'douga_henshuu',count:2},{id:'super_chat',count:2},{id:'impression_seigen',count:1},{id:'douga_fukugen',count:2},{id:'seitokaichou',count:2},{id:'osananajimi',count:2},{id:'mensetsu_kan',count:2},{id:'dansou',count:2},{id:'jk_a',count:2},{id:'imouto',count:2},{id:'milia',count:1},{id:'reichen',count:1},{id:'shinigami',count:1},{id:'jun',count:1},{id:'maoria',count:1},{id:'izuna',count:1},{id:'tomo',count:1},{id:'ark',count:1},{id:'sagi',count:1},{id:'azusa',count:1},{id:'mamachari',count:1}]
};

// 取得種別の既定値: 全既存カードは無料・無制限(acquire:'free')。
// 将来のガチャカードは定義に acquire:'gacha' を書けば deckValidation の所有チェック対象になる。
CARD_DB.forEach(c=>{ if(!c.acquire) c.acquire='free'; });

// アプリ(ネイティブ)の時だけ、更新確認のスクリプトをサーバーから読み込む(shared/app_gate.js)。
// このファイルはアプリでも起動のたびにサーバーから読まれるので、配布済みの古いアプリにも確認が届く。
// サーバー(Node)がこのファイルを require した時と、ブラウザ版では何もしない
if(typeof window!=='undefined'&&typeof document!=='undefined'&&window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()){
  try{var _gate=document.createElement('script');_gate.src='https://game.sarubedo.jp/shared/app_gate.js?t='+Date.now();(document.head||document.documentElement).appendChild(_gate);}catch(e){}
}

// Node.js用エクスポート（ブラウザでは無視される）
if(typeof module!=='undefined'&&module.exports){
  module.exports={CARD_DB,TOKEN_MONSTER,TOKEN_JK,TOKEN_V,TOKEN_ZERATINE_CHILD,TOKEN_DAISUKE,STARTER_DECKS,makeCard,buildDeck,newUid};
}
