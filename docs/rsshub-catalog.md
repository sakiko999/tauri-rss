# RSSHub 简单路由购物清单（静态摘录）

> 由 `scripts/rsshub-catalog.ts` 生成。不跑 RSSHub 运行时，仅静态扫 `tmp/RSSHub/lib/routes`，
> 筛 `requirePuppeteer:false & antiCrawler:false & requireConfig:false` 的路由。
> 这是后续「逐路由最小复刻」的**起点清单**，不是开箱即用的 feed URL 列表。

## 概况

| 指标 | 数量 |
| --- | --- |
| 扫描文件（全量基线） | 5729 |
| 本次处理 | 5729 |
| 简单路由 | 2079 |
| 其中真·原生 feed 直传 | 20 |
| 分类 | 25 |
| namespace | 1680 |

## ⭐ 原生 feed 直传（最易复刻）

handler 里直接 `ofetch(….{xml,rss,atom})`，最接近「开箱即用」。**仍需逐个 curl 验证**：

| namespace | route | 上游 feed | 域名 |
| --- | --- | --- | --- |
| ntrblog | Articles | https://ntrblog.com/atom.xml |  |
| deepmind | Blog | https://www.deepmind.com/blog/rss.xml | deepmind.com/blog |
| eprice | 最新消息 | https://www.eprice.com.${region}/news/rss.xml | eprice.com.tw |
| onet | News | https://wiadomosci.onet.pl/.feed | wiadomosci.onet.pl/ |
| theverge | Category | https://www.theverge.com/rss/index.xml |  |
| github | User Activities | https://github.com/${user}.atom |  |
| maven | Maven Central Feed | https://repo1.maven.org/maven2/${identifier}/maven-metadata.xml | central.sonatype.com/ |
| nodejs | News | https://nodejs.org/en/feed/blog.xml |  |
| visualstudio | Code Blog | https://code.visualstudio.com/feed.xml | code.visualstudio.com |
| warp | Blog | https://www.warp.dev/blog/feed.xml | warp.dev |
| zed | Blog | https://zed.dev/blog.rss | zed.dev |
| papers | Category | https://papers.cool/arxiv/physics.atom-ph | papers.cool |
| cnbc | Full article RSS | https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=${id} | search.cnbc.com |
| economist | Category | https://www.economist.com/china/rss.xml |  |
| foreignaffairs | RSS | https://www.foreignaffairs.com/rss.xml | www.foreignaffairs.com |
| npr | News | https://feeds.npr.org/${endpoint}/rss.xml |  |
| solidot | 最新消息 | https://www.solidot.org/index.rss |  |
| yna | News | https://www.yna.co.kr/rss/economy.xml |  |
| bilibili | 视频弹幕 | https://comment.bilibili.com/${cid}.xml |  |
| bsky | Keywords | https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(keyword |  |

## 按分类

### anime (85)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 005 | 资讯 | `/005/zx` | 005.tv |  |
| acfun | 文章 | `/acfun/article/110` |  |  |
| acfun | 番剧 | `/acfun/bangumi/6000617` |  |  |
| acg17 | 全部文章 | `/acg17/post/all` | acg17.com/post |  |
| acgvinyl | News | `/acgvinyl/news` | www.acgvinyl.com/col.jsp?id=103 |  |
| agefans | 番剧详情 | `/agefans/detail/20200035` |  |  |
| agefans | 最近更新 | `/agefans/update` | agemys.org/update |  |
| anime1 | Anime | `/anime1/anime/2024年夏季/神之塔-第二季` | anime1.me |  |
| anime1 | Search | `/anime1/search/神之塔` | anime1.me |  |
| bangumi.tv/calendar | 放送列表 | `/bangumi.tv/calendar/today` | bgm.tv/calendar |  |
| bangumi.tv/group | 小组话题的新回复 | `/bangumi.tv/topic/367032` |  |  |
| bangumi.tv/group | 小组话题 | `/bangumi.tv/group/boring` |  |  |
| bangumi.tv/other | 成员关注榜 | `/bangumi.tv/anime/followrank` |  |  |
| bangumi.tv/person | 现实人物的新作品 | `/bangumi.tv/person/32943` |  |  |
| bangumi.tv/subject | 条目的通用路由格式 | `/bangumi.tv/subject/328609/ep/true` |  |  |
| bangumi.tv/user | 用户日志 | `/bangumi.tv/user/blog/sai` |  |  |
| bangumi.tv/user | Bangumi 用户收藏列表 | `/bangumi.tv/user/collections/sai/1/1` |  |  |
| baozimh | 漫画名称，在漫画链接可以得到( | `/baozimh/comic/guowangpaiming-shiricaofu` |  |  |
| bgmlist | 开播提醒 | `/bgmlist/onair/zh-Hans` | bgmlist.com |  |
| cartoonmad | 漫画更新 | `/cartoonmad/comic/5827` |  |  |
| cngal | 制作者 / 游戏新闻 | `/cngal/entry/2693` |  |  |
| cngal | 每周速报 | `/cngal/weekly` | www.cngal.org/ |  |
| collabo-cafe | 分类 | `/collabo-cafe/category/cafe` |  |  |
| collabo-cafe | 全部文章 | `/collabo-cafe/` |  |  |
| collabo-cafe | 标签 | `/collabo-cafe/tag/ikebukuro` | collabo-cafe.com |  |
| comic-fuz | 杂志详情 | `/comic-fuz/magazine/27860` |  |  |
| comic-fuz | 漫画详情 | `/comic-fuz/manga/218` |  |  |
| comic-walker | 漫画详情 | `/comic-walker/manga/KC_006778_S` |  |  |
| comicat | 搜索关键词 | `/comicat/search/喵萌奶茶屋+跃动青春+720P+简日` | comicat.org | BT |
| comicskingdom | URL path of the strip on comicskingdom.com | `/comicskingdom/pardon-my-planet` |  |  |
| copymanga | 漫画更新 | `/copymanga/comic/dianjuren/5` |  |  |
| creative-comic | 漫畫 | `/creative-comic/book/117` |  |  |
| denonbu | 新闻 | `/denonbu/news/azabu` | denonbu.jp |  |
| dlsite | Discounted Works | `/dlsite/campaign/home` |  |  |
| dlsite | Current Release | `/dlsite/new/home` | dlsite.com |  |
| dlsite/ci-en | Ci-en Creators | `/dlsite/ci-en/7400/article` |  |  |
| dmzj | 新闻站 | `/dmzj/news/donghuaqingbao` | news.dmzj.com/ |  |
| dora-world | Article | `/dora-world/article/contents` |  |  |
| eventernote | 声优姓名 | `/eventernote/actors/三森すずこ/2634` |  |  |
| fffdm/manhua | 在线漫画 | `/fffdm/manhua/93` |  |  |
| gamer | 本板推薦 | `/gamer/hot/47157` |  |  |
| gamer/ani | 動畫瘋 - 動畫 | `/gamer/ani/anime/36868` |  |  |
| gamer/ani | 動畫瘋 - 最後更新 | `/gamer/ani/new_anime` | ani.gamer.com.tw/ |  |
| gogoanimehd | Recent Releases | `/gogoanimehd/recent-releases` | developer.anitaku.to/ |  |
| hanime1 | 每月新番 | `/hanime1/previews/202504` | hanime1.me |  |
| hanime1 | 搜索结果 | `/hanime1/search/tags%5B%5D=%E7%B4%94%E6%84%9B&` | hanime1.me |  |
| hpoi | 所有周边 | `/hpoi/items/all` | www.hpoi.net/hobby/all |  |
| hpoi | 热门推荐 | `/hpoi/bannerItem` | www.hpoi.net/bannerItem/list |  |
| hpoi | 角色周边 | `/hpoi/items/character/1035374` |  |  |
| hpoi | 情报 | `/hpoi/info/all/hobby|model` |  |  |
| hpoi | 用户动态 | `/hpoi/user/116297/buy` | www.hpoi.net |  |
| hpoi | 作品周边 | `/hpoi/items/work/4117491` | www.hpoi.net |  |
| idolmaster | ニュース News | `/idolmaster/news/brand=MILLIONLIVE&brand=SHINYCOLORS&category=GAME&category=ANIME` | idolmaster-official.jp/news |  |
| idolypride | News | `/idolypride/news` | idolypride.jp/news |  |
| kemono | Posts | `/kemono` |  |  |
| komiic | 漫画更新 | `/komiic/comic/533` |  |  |
| laimanhua | 漫画列表 | `/laimanhua/tiandikangzhanjiVERSUS` |  |  |
| lovelive-anime | News | `/lovelive-anime/news` | www.lovelive-anime.jp/ |  |
| melonbooks | 搜索结果 | `/melonbooks/search/name=けいおん` | www.melonbooks.co.jp |  |
| ntdm | 番剧详情 | `/ntdm/video/4309` | www.ntdm9.com |  |
| ntrblog | Articles | `/ntrblog/articles` |  | native-feed |
| omegascans | Series Chapters | `/omegascans/series/632` | omegascans.org |  |
| oreno3d | Author Search | `/oreno3d/authors/3189/latest/1` |  |  |
| pawchive | Posts | `/pawchive/fanbox/22445` |  |  |
| pixivision | Category | `/pixivision/zh-tw` |  |  |
| qoo-app | News | `/qoo-app/news/en` | apps.qoo-app.com |  |
| qoo-app/apps | Game Store - Cards | `/qoo-app/apps/en/card/7675` |  |  |
| qoo-app/apps | Game Store - Review | `/qoo-app/apps/en/comment/7675` |  |  |
| qoo-app/apps | Game Store - Notes | `/qoo-app/apps/en/note/7675` |  |  |
| qoo-app/apps | Game Store - Article | `/qoo-app/apps/en/post/7675` |  |  |
| qoo-app/notes | Note Comments | `/qoo-app/notes/en/note/2329113` |  |  |
| qoo-app/notes | Hot Hashtags | `/qoo-app/notes/en/topic/QooAppGacha` |  |  |
| qoo-app/notes | User Notes | `/qoo-app/notes/en/user/35399143` |  |  |
| qoo-app/user | User Game Comments | `/qoo-app/user/en/appComment/35399143` |  |  |
| qq/ac | 排行榜 | `/qq/ac/rank` |  |  |
| rawkuma | Manga | `/rawkuma/manga/tensei-shitara-dai-nana-ouji-dattanode-kimamani-majutsu-o-kiwamemasu` |  |  |
| skebetter | Illust | `/skebetter/illust/hot` |  |  |
| skebetter | Hot | `/skebetter/hot` |  |  |
| skebetter | Manga | `/skebetter/manga/1` |  |  |
| thwiki | Calendar | `/thwiki/calendar` | thwiki.cc/ |  |
| toranoana | Category | `/toranoana/news/toragen` | toranoana.jp |  |
| vcb-s | 分类文章 | `/vcb-s/category/works` | vcb-s.com/ |  |
| xmanhua | 最新动态 | `/xmanhua/73xm` |  |  |
| ymgal | 文章 | `/ymgal/article` |  |  |
| ymgal | 本月新作 | `/ymgal/game/release` | ymgal.games/ |  |

### bbs (58)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 19lou | 头条 | `/19lou/jiaxing` |  |  |
| 1point3acres | 博客 | `/1point3acres/blog` |  |  |
| 1point3acres | 标签 | `/1point3acres/category/h1b` |  |  |
| 1point3acres | 录取结果 | `/1point3acres/offer/12/null/CMU` | offer.1point3acres.com/ |  |
| 1point3acres | 分区 | `/1point3acres/section/345` | blog.1point3acres.com |  |
| 1point3acres/user | 用户回帖 | `/1point3acres/user/1/posts` |  |  |
| 1point3acres/user | 用户主题帖 | `/1point3acres/user/1/threads` |  |  |
| 4chan | Board | `/4chan/g/catalog` |  |  |
| 8264 | 列表 | `/8264/list/751` |  |  |
| chongbuluo | 最新发表 | `/chongbuluo/newthread` |  |  |
| douyu | 鱼吧帖子 | `/douyu/group/1011` |  |  |
| douyu | 鱼吧跟帖 | `/douyu/post/631737151576473201` | www.douyu.com |  |
| dxy | 专题 | `/dxy/bbs/special/72` | dxy.cn |  |
| dxy/profile | 个人帖子 | `/dxy/bbs/profile/thread/8335054` |  |  |
| elasticsearch-cn | 发现 | `/elasticsearch-cn` |  |  |
| eleduck | 工作机会 | `/eleduck/jobs` | eleduck.com/categories/5 |  |
| eleduck | 分类文章 | `/eleduck/posts/4` | eleduck.com |  |
| feng | 社区 | `/feng/forum/1` |  |  |
| flyert | 会员说 | `/flyert/forum` | www.flyert.com.cn |  |
| huoxian | Zone | `/huoxian/zone` | zone.huoxian.cn |  |
| hupu | 热帖 | `/hupu/all/topic-daily` |  |  |
| hupu | 社区 | `/hupu/bbs/topic-daily` |  |  |
| learnku | 社区 | `/learnku/laravel/qa` | learnku.com |  |
| meteor | 看板列表 | `/meteor/boards` | meteor.today/ |  |
| meteor | 看板 | `/meteor/all` |  |  |
| miui/community | 小米社区用户发帖 | `/miui/community/user/1200057564` |  |  |
| nga | 分区帖子 | `/nga/forum/489` |  |  |
| nga | 帖子 | `/nga/post/18449558` | bbs.nga.cn |  |
| nowcoder | 讨论区 | `/nowcoder/discuss/2/4` |  |  |
| nowcoder | 面经 | `/nowcoder/experience/639?order=3&companyId=665&phaseId=0` | nowcoder.com/ |  |
| nowcoder | 牛客热榜 | `/nowcoder/hots/1?limit=20` | nowcoder.com/ |  |
| nowcoder | 牛客面试经验 | `/nowcoder/interview/11200` | nowcoder.com/ |  |
| nowcoder | 实习广场 & 社招广场 | `/nowcoder/jobcenter/1/北京/1/1/true` | nowcoder.com/ |  |
| nowcoder | 求职推荐 | `/nowcoder/recommend` | nowcoder.com/ |  |
| nowcoder | 校招日程 | `/nowcoder/schedule` | nowcoder.com/ |  |
| pikabu | User name | `/pikabu/user/@bula.dragon` | pikabu.ru |  |
| pkmer | 最近更新 | `/pkmer/recent` | pkmer.cn/page/* |  |
| playno1 | AV | `/playno1/av` |  |  |
| playno1 | 情趣 | `/playno1/st` | stno1.playno1.com |  |
| qq/pd | 腾讯频道 | `/qq/pd/guild/qrp4pkq01d/650967831/created` | pd.qq.com/ |  |
| right | 板块 | `/right/forum/31` |  |  |
| saraba1st | 论坛摘要 | `/saraba1st/digest/forum-6-1` |  |  |
| saraba1st | 帖子 | `/saraba1st/thread/751272` | stage1st.com |  |
| sis001 | 作者 | `/sis001/author/13131575` |  |  |
| sis001 | 子版块 | `/sis001/forum/322` |  |  |
| trow | 首页更新 | `/trow/portal` | trow.cc/ |  |
| txrjy | 论坛 频道 | `/txrjy/fornumtopic` |  |  |
| v2ex | 帖子 | `/v2ex/post/584403` | v2ex.com |  |
| v2ex | 标签 | `/v2ex/tab/hot` | v2ex.com |  |
| v2ex | 最热 / 最新主题 | `/v2ex/topics/latest` | v2ex.com |  |
| v2ex | XNA | `/v2ex/xna` | v2ex.com |  |
| xiaote | 首页帖子 | `/xiaote/news` | xiaote.com/ |  |
| yuanliao | 主题 | `/yuanliao` | yuanliao.info |  |
| zhibo8 | 子论坛 | `/zhibo8/forum/8` |  |  |
| zhibo8 | 滚动新闻 | `/zhibo8/more/nba` |  |  |
| zhibo8 | 回帖 | `/zhibo8/post/3050708` | zhibo8.cc |  |
| zuvio | 看板列表 | `/zuvio/student5/boards` |  |  |
| zuvio | 校園話題 | `/zuvio/student5/34` | irs.zuvio.com.tw |  |

### blog (62)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| aiblog-2xv | 归档-全部文章 | `/aiblog-2xv/archives` |  |  |
| apache/apisix | APISIX 博客 | `/apache/apisix/blog` |  |  |
| apiseven | 博客 | `/apiseven/blog` |  |  |
| backlinko | Blog | `/backlinko/blog` | backlinko.com/blog |  |
| baselang | Blog | `/baselang/blog` |  |  |
| caixin | 用户博客 | `/caixin/blog/zhangwuchang` |  |  |
| ceph | Blog | `/ceph/blog/a11y` | ceph.io |  |
| chuanliu | 严选 | `/chuanliu/nice` | chuanliu.org/nice |  |
| cline | Blog | `/cline/blog` | cline.bot/blog |  |
| cloudnative | 博客 | `/cloudnative/blog` |  |  |
| cmpxchg8b | Articles | `/cmpxchg8b/articles` | lock.cmpxchg8b.com/articles |  |
| cmu/andypavlo | Andy Pavlo Blog | `/cmu/andypavlo/blog` |  |  |
| cnblogs | 10 天推荐排行榜 | `/cnblogs/aggsite/topdiggs` | www.cnblogs.com/pick |  |
| cohere | Blog | `/cohere/blog` | cohere.com/blog |  |
| coolidge | Film Guide | `/coolidge/film-guide` | coolidge.org/film-guide |  |
| coolidge | News | `/coolidge/news` | coolidge.org/about-us/news-media |  |
| csdn | User Feed | `/csdn/blog/csdngeeknews` |  |  |
| cursor | Blog | `/cursor/blog` | cursor.com |  |
| dayanzai | 分类 | `/dayanzai/windows` |  |  |
| ddosi | 分类 | `/ddosi/category/黑客工具` | ddosi.org/ |  |
| deltaio | Blogs | `/deltaio/blog` | delta.io/blog |  |
| eagle | Blog | `/eagle/blog/en` | cn.eagle.cool/blog |  |
| englishhome | 首頁 | `/englishhome` |  |  |
| flashcat | 快猫星云博客 | `/flashcat/blog` |  |  |
| foreverblog | 专题展示 - 文章 | `/foreverblog/feeds` | www.foreverblog.cn/feeds.html |  |
| freebuf | 文章 | `/freebuf/articles/web` |  |  |
| fxiaoke | 文章 | `/fxiaoke/crm/news` |  |  |
| gaoyu | Blog | `/gaoyu/blog` | www.gaoyu.me |  |
| geocaching | Official Blogs | `/geocaching/blogs/en` | geocaching.com/blog/ |  |
| gs/developer | Goldman Sachs Developer Blog | `/gs/developer/blog` |  |  |
| hashnode | 用户博客 | `/hashnode/blog/inklings` | hashnode.dev/ |  |
| hudsonrivertrading | Tech Blog | `/hudsonrivertrading/blog` |  |  |
| humanlayer | Blog | `/humanlayer/blog` | www.humanlayer.dev/blog |  |
| ianspriggs | Category | `/ianspriggs/portraits` |  |  |
| jamesclear | Book Summaries | `/jamesclear/book-summaries` |  |  |
| jamesclear | Great Speeches | `/jamesclear/great-speeches` |  |  |
| jamesclear | Quotes | `/jamesclear/quotes` | jamesclear.com |  |
| jamesclear | 3-2-1 Newsletter | `/jamesclear/3-2-1` | jamesclear.com |  |
| kadokawa | 角編新聞台 | `/kadokawa/blog` | kadokawa.com.tw |  |
| kunchengblog | Essay | `/kunchengblog/essay` | kunchengblog.com/essay |  |
| luolei | 罗磊的独立博客 | `/luolei` | luolei.org |  |
| luxiangdong | 文章 | `/luxiangdong/archive` | luxiangdong.com/ |  |
| macmenubar | Recently | `/macmenubar/recently/developer-apps,system-tools` | macmenubar.com |  |
| mathpix | Blog | `/mathpix/blog` | mathpix.com |  |
| medium | Medium Feed | `/medium/feed/zhgchgli` |  |  |
| medium | List | `/medium/list/imsingee/f2d8d48096a9` |  |  |
| meteoblue | Weather News | `/meteoblue/weathernews` | meteoblue.com |  |
| mit | HAN Lab Blog | `/mit/hanlab/blog` |  |  |
| obsidian | Publish | `/obsidian/publish/marshallontheroad` | publish.obsidian.md/ |  |
| oct0pu5 | Oct的小破站 | `/oct0pu5` | Oct0pu5.cn |  |
| paulgraham | Essays | `/paulgraham/articles` | paulgraham.com/articles.html |  |
| react | Blog | `/react/blog` |  |  |
| readsomethingwonderful | Articles | `/readsomethingwonderful` |  |  |
| stanford | Hazy Research Blog | `/stanford/hazyresearch/blog` | hazyresearch.stanford.edu/blog |  |
| substack | Substack Subscription | `/substack/subscribe/mangoread` | substack.com |  |
| uber | Engineering | `/uber/blog` | www.uber.com/en-HK/blog/engineering |  |
| xunhupay | 文章 | `/xunhupay/blog` | www.xunhupay.com/blog |  |
| xys | 新到资料 | `/xys/new` | xys.org/ |  |
| youmemark | Bookmarks | `/youmemark/pseudoyu` |  |  |
| zhubai | 文章 | `/zhubai/posts/via` |  |  |
| zhubai | 上周热门 TOP 20 | `/zhubai/top20` | analy.zhubai.love/ |  |
| zjuvag | 博客 | `/zjuvag/blog` |  |  |

### design (12)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 1x | Gallery | `/1x/latest/awarded` | 1x.com |  |
| behance | User Works | `/behance/mishapetrick` | www.behance.net |  |
| bossdesign | 分类 | `/bossdesign` |  |  |
| dribbble | Keyword | `/dribbble/keyword/player` |  |  |
| dribbble | Popular | `/dribbble/popular` | dribbble.com/ |  |
| dribbble | username, available in user | `/dribbble/user/google` | dribbble.com |  |
| iguoguo | 最新 H5 | `/iguoguo/html5` |  |  |
| notefolio | Works | `/notefolio/search/1/pick/all/life` | notefolio.net/search |  |
| shoppingdesign | 文章列表 | `/shoppingdesign/posts` | www.shoppingdesign.com.tw/post |  |
| zcool | 发现 | `/zcool/discover` |  |  |
| zcool | 作品总榜单 | `/zcool/top/design` | www.zcool.com.cn |  |
| zcool | 用户作品 | `/zcool/user/baiyong` | www.zcool.com.cn |  |

### finance (117)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 10jqka | 7×24小时要闻直播 | `/10jqka/realtimenews` | news.10jqka.com.cn |  |
| 21caijing | 频道 | `/21caijing/channel/热点` | m.21jingji.com |  |
| ainvest | Latest Article | `/ainvest/article` | www.ainvest.com/news/articles-latest/ |  |
| ainvest | Latest News | `/ainvest/news` | www.ainvest.com/news/ |  |
| baidu/gushitong | 首页指数 | `/baidu/gushitong/index` | gushitong.baidu.com/ |  |
| barronschina | 栏目 | `/barronschina` | barronschina.com.cn/ |  |
| bigquant | 专题报告 | `/bigquant/collections` | bigquant.com/ |  |
| blockworks | News | `/blockworks` |  |  |
| bse | 栏目 | `/bse` | bse.cn/ |  |
| bullionvault | Gold News | `/bullionvault/gold-news` | bullionvault.com |  |
| caijing | 滚动新闻 | `/caijing/roll` | roll.caijing.com.cn/index1.html |  |
| capitalmind | Podcasts | `/capitalmind/podcasts` | capitalmind.in | podcast |
| chinamoney | 公告 | `/chinamoney` | chinamoney.com.cn |  |
| chinaratings | 中债研究 | `/chinaratings/CreditResearch` | www.chinaratings.com.cn |  |
| cih-index | 报告 | `/cih-index/report/list/p1-oaddtime-ddesc` | www.cih-index.com/report/list/p1-oaddtime-ddesc |  |
| cls | 深度 | `/cls/depth/1000` |  |  |
| cls | 话题 | `/cls/subject/1103` | www.cls.cn |  |
| cls | 电报 | `/cls/telegraph` | cls.cn/telegraph |  |
| coindesk | News | `/coindesk/news` | coindesk.com |  |
| cointelegraph | News | `/cointelegraph` |  |  |
| cryptoslate | News | `/cryptoslate` |  |  |
| cs | 栏目 | `/cs` | www.cs.com.cn |  |
| cs | 中证视频 | `/cs/video/今日聚焦` | cs.com.cn |  |
| decrypt | News | `/decrypt` |  |  |
| dtcj | 数据侠专栏 | `/dtcj/datahero` |  |  |
| dtcj | 数据洞察 | `/dtcj/datainsight` | dtcj.com/dtcj/datainsight |  |
| eastmoney/gerenzhongxin | 个人中心长文 | `/eastmoney/gerenzhongxin/cfh/2922094262312522` |  |  |
| eastmoney/gerenzhongxin | 个人中心所有活动 | `/eastmoney/gerenzhongxin/gather/2922094262312522` |  |  |
| eastmoney/gerenzhongxin | 个人中心帖子 | `/eastmoney/gerenzhongxin/guba/2922094262312522` |  |  |
| eastmoney/gerenzhongxin | 个人中心评论 | `/eastmoney/gerenzhongxin/trpl/2922094262312522` |  |  |
| eastmoney/report | 研究报告 | `/eastmoney/report/strategyreport` |  |  |
| eastmoney/search | 搜索 | `/eastmoney/search/web3` |  |  |
| eastmoney/ttjj | 天天基金用户动态 | `/eastmoney/ttjj/user/6551094298949188` |  |  |
| eeo | 快讯 | `/eeo/kuaixun` | www.eeo.com.cn |  |
| fastbull | News Flash | `/fastbull/express-news` | fastbull.com/express-news |  |
| fastbull | News | `/fastbull/news` | fastbull.com/news |  |
| finology | Bullets | `/finology/bullets` | insider.finology.in/bullets |  |
| finviz | News | `/finviz` | finviz.com/news.ashx |  |
| finviz | US Stock News | `/finviz/news/AAPL` | finviz.com |  |
| followin | Home | `/followin` |  |  |
| followin | KOL | `/followin/kol/4075592991` |  |  |
| followin | News | `/followin/news` | followin.io |  |
| followin | Tag | `/followin/tag/177008` | followin.io |  |
| followin | Topic | `/followin/topic/40` | followin.io |  |
| fx-markets | Channel | `/fx-markets/trading` |  |  |
| fx678 | 7x24 小时快讯 | `/fx678/kx` | fx678.com/kx |  |
| gelonghui | 首页 | `/gelonghui/home` |  |  |
| gelonghui | 最热文章 | `/gelonghui/hot-article` | gelonghui.com/ |  |
| gelonghui | 搜索关键字 | `/gelonghui/keyword/早报` |  |  |
| gelonghui | 实时快讯 | `/gelonghui/live` | gelonghui.com/live |  |
| gelonghui | 主题文章 | `/gelonghui/subject/4` | gelonghui.com |  |
| gelonghui | 用户文章 | `/gelonghui/user/5273` | gelonghui.com |  |
| gov/pbc | 工作论文 | `/gov/pbc/gzlw` | pbc.gov.cn/redianzhuanti/118742/4122386/4122692/index.html |  |
| huijin-inv | 资讯中心 | `/huijin-inv/news` | www.huijin-inv.cn |  |
| hyperdash | Top Traders | `/hyperdash/top-traders` | hyperdash.info |  |
| investor | 栏目 | `/investor/home/zxdt` | www.investor.org.cn |  |
| jin10 | 外汇 | `/jin10/category/36` | jin10.com/ |  |
| jin10 | 市场快讯 | `/jin10` | jin10.com/ |  |
| jin10 | 主题文章 | `/jin10/topic/396` | jin10.com/ |  |
| jinse | 分类 | `/jinse/zhengce` |  |  |
| jinse | 快讯 | `/jinse/lives` |  |  |
| jinse | 首页 | `/jinse/timeline` | jinse.com.cn |  |
| jisilu | 分类 | `/jisilu/category/4` | www.jisilu.cn |  |
| jisilu | 广场 | `/jisilu/explore` | www.jisilu.cn |  |
| jisilu | 用户 | `/jisilu/people/天书` | www.jisilu.cn |  |
| jisilu | 话题 | `/jisilu/topic/可转债` | www.jisilu.cn |  |
| jpmorganchase | Research Topics | `/jpmorganchase` | www.jpmorganchase.com/institute/all-topics |  |
| laohu8 | 个人主页 | `/laohu8/personal/3527667596890271` | laohu8.com |  |
| lhratings | 研究报告 | `/lhratings/research/92` | www.lhratings.com |  |
| mckinsey/cn | 洞见 | `/mckinsey/cn` |  |  |
| mrm | 通知 | `/mrm` |  |  |
| nbd | 重磅原创 | `/nbd/daily` | nbd.com.cn/ |  |
| nbd | 分类 | `/nbd` | nbd.com.cn/ |  |
| nifd | 研究 | `/nifd/research/3333d2af-91d6-429b-be83-28b92f31b6d7` | www.nifd.cn |  |
| okx | 公告 | `/okx/new-listings` |  |  |
| paradigm | Writing | `/paradigm/writing` | paradigm.xyz/writing |  |
| polymarket | Event | `/polymarket/event/presidential-election-winner-2024` | polymarket.com |  |
| polymarket | Events | `/polymarket/events` | polymarket.com |  |
| polymarket | Leaderboard | `/polymarket/leaderboard` | polymarket.com |  |
| polymarket | User Positions | `/polymarket/positions/0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b` | polymarket.com |  |
| polymarket | Search | `/polymarket/search/trump` | polymarket.com |  |
| polymarket | Series | `/polymarket/series` | polymarket.com |  |
| polymarket | User Activity | `/polymarket/user/0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b` | polymarket.com |  |
| qianzhan | 文章列表 | `/qianzhan/analyst/column/all` |  |  |
| qianzhan | 排行榜 | `/qianzhan/analyst/rank/week` | qianzhan.com/analyst |  |
| sse | 可转换公司债券公告 | `/sse/convert/beginDate=2018-08-18&endDate=2019-08-18&companyCode=603283&title=股份` |  |  |
| sse | 上市公司信息最新公告披露 | `/sse/disclosure/beginDate=2018-08-18&endDate=2020-08-25&productId=600696` |  |  |
| sse | 监管问询 | `/sse/inquire` | www.sse.com.cn/disclosure/credibility/supervision/inquiries |  |
| sse | 科创板项目动态 | `/sse/renewal` | kcb.sse.com.cn/home |  |
| sse | 本所业务规则 | `/sse/sselawsrules/latest` | www.sse.com.cn |  |
| stcn | 列表 | `/stcn/article/list/yw` | www.stcn.com |  |
| stcn | 快讯 | `/stcn/article/list/kx` | www.stcn.com |  |
| stcn | 热榜 | `/stcn/article/rank/yw` | www.stcn.com |  |
| stockedge | Daily Updates News | `/stockedge/daily-updates/news` | web.stockedge.com/daily-updates/news |  |
| szse | 问询函件 | `/szse/inquire` | szse.cn/disclosure/supervision/inquire/index.html |  |
| szse | 上市公告 - 可转换债券 | `/szse/notice` | szse.cn/disclosure/notice/company/index.html |  |
| szse | 创业板项目动态 | `/szse/projectdynamic` | listing.szse.cn/projectdynamic/1/index.html |  |
| szse | 本所业务规则 | `/szse/rule/allrules/bussiness` | www.szse.cn |  |
| szse/disclosure | 上市公司公告 | `/szse/disclosure/listed/notice` | www.szse.cn |  |
| taoguba | 用户博客 | `/taoguba/blog/252069` |  |  |
| theblock | Category | `/theblock/category/crypto-ecosystems` |  |  |
| tokeninsight | Blogs | `/tokeninsight/blog/en` |  |  |
| tokeninsight | Latest | `/tokeninsight/bulletin/en` |  |  |
| tokeninsight | Research | `/tokeninsight/report/en` | tokeninsight.com |  |
| ulapia | 频道 | `/ulapia/reports/stock_research` |  |  |
| ulapia | 最新研报 | `/ulapia/research/latest` | www.ulapia.com/ |  |
| unusualwhales | News Feed | `/unusualwhales/news` | unusualwhales.com/news |  |
| wallstreetcn | 财经日历 | `/wallstreetcn/calendar` | wallstreetcn.com/calendar |  |
| wallstreetcn | 最热文章 | `/wallstreetcn/hot` | wallstreetcn.com/ |  |
| wallstreetcn | 实时快讯 | `/wallstreetcn/live` |  |  |
| xueqiu | 用户收藏动态 | `/xueqiu/favorite/8152922548` |  |  |
| xueqiu | 蛋卷基金净值更新 | `/xueqiu/fund/040008` |  |  |
| xueqiu | 热帖 | `/xueqiu/hots` | xueqiu.com/ |  |
| xueqiu | 组合最新调仓信息 | `/xueqiu/snb/ZH1288184` | danjuanapp.com |  |
| xueqiu | 股票评论 | `/xueqiu/stock_comments/SZ002626` | danjuanapp.com |  |
| youzhiyouxing | 有知文章 | `/youzhiyouxing/materials` | youzhiyouxing.cn/materials |  |
| zhitongcaijing | 推荐 | `/zhitongcaijing` |  |  |

### forecast (24)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 121 | 深圳天气直播 | `/121/weatherLive` | tf.121.com.cn |  |
| bmkg | Recent Earthquakes | `/bmkg/earthquake` | bmkg.go.id/ |  |
| bmkg | News | `/bmkg/news` | bmkg.go.id/ |  |
| cneb | 应急新闻 | `/cneb/yjxw` | cneb.gov.cn |  |
| cneb | 预警信息 | `/cneb/yjxx` | cneb.gov.cn/yjxx |  |
| cqgas | 停气检修通知 | `/cqgas/tqtz` | cqgas.cn/ |  |
| earthquake | 中国地震台 | `/earthquake/ceic/1` | www.cea.gov.cn/cea/xwzx/zqsd/index.html |  |
| ncc-cma | 最新监测 | `/ncc-cma/cmdp/image/RPJQWQYZ` | cmdp.ncc-cma.net |  |
| nmc | 产品 | `/nmc/publish/observations/hourly-temperature/html` | www.nmc.cn |  |
| nmc | 全国气象预警 | `/nmc/weatheralarm/广东省` | nmc.cn/publish/alarm.html |  |
| outagereport | Service name, spelling format must be consistent with URL | `/outagereport/ubisoft/5` |  |  |
| tingshuitz | 长沙市 | `/tingshuitz/changsha/78` |  |  |
| tingshuitz | 大连市 | `/tingshuitz/dalian` | swj.dl.gov.cn/col/col4296/index.html |  |
| tingshuitz | 东莞市 | `/tingshuitz/dongguan` |  |  |
| tingshuitz | 广州市 | `/tingshuitz/guangzhou` |  |  |
| tingshuitz | 杭州市 | `/tingshuitz/hangzhou` | www.hzwgc.com/public/stop_the_water |  |
| tingshuitz | 南京市 | `/tingshuitz/nanjing` | jlwater.com/portal/10000015 |  |
| tingshuitz | 深圳市 | `/tingshuitz/shenzhen` | sz-water.com.cn/* |  |
| tingshuitz | 西安市 | `/tingshuitz/xian` | swj.dl.gov.cn |  |
| tingshuitz | 萧山区 | `/tingshuitz/xiaoshan` | www.xswater.com/gongshui/channels/227.html |  |
| tingshuitz | 阳江市 | `/tingshuitz/yangjiang` | yjsswjt.com/zxdt_list.jsp |  |
| tqyb | 广东省内城市预警信号 | `/tqyb/sncsyjxh` | www.tqyb.com.cn/gz/weatherAlarm/otherCity/ |  |
| tqyb | 突发性天气提示 | `/tqyb/tfxtq` | www.tqyb.com.cn/gz/weatherAlarm/suddenWeather/ |  |
| uptimerobot | RSS | `/uptimerobot/rss/u358785-e4323652448755805d668f1a66506f2f` | rss.uptimerobot.com |  |

### game (102)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 163 | 用户发帖 | `/163/ds/63dfbaf4117741daaf73404601165843` |  |  |
| 2023game | 游戏星辰 | `/2023game/sgame/topicList` | www.2023game.com/ |  |
| 3dmgame | 新闻中心 | `/3dmgame/news` | 3dmgame.com |  |
| 3kns | 3k-Switch游戏库 | `/3kns/category=all&lang=all` | www.3kns.com/ |  |
| 4gamers | 标签 | `/4gamers/tag/限時免費` | www.4gamers.com.tw/news |  |
| 4gamers | 主題 | `/4gamers/topic/gentlemen-topic` | www.4gamers.com.tw/news |  |
| 5eplay | 新闻列表 | `/5eplay/article` | csgo.5eplay.com/ |  |
| a9vg | 新闻 | `/a9vg/news` | a9vg.com |  |
| ali213 | 资讯 | `/ali213/news/new` | www.ali213.net |  |
| ali213 | 大侠号 | `/ali213/zl` | www.ali213.net |  |
| alicesoft | ニュース | `/alicesoft/information/game/cat377` | www.alicesoft.com/information |  |
| azurlane | News | `/azurlane/news/jp/0` |  |  |
| blizzard | 暴雪游戏国服新闻 | `/blizzard/news-cn/ow` | news.blizzard.com |  |
| blizzard | News | `/blizzard/news` | news.blizzard.com |  |
| bluearchive | News | `/bluearchive/news/jp` | bluearchive.jp |  |
| chuapp | 分类 | `/chuapp/daily` |  |  |
| counter-strike | News | `/counter-strike/news` | www.counter-strike.net |  |
| deadbydaylight | Latest News | `/deadbydaylight/blog` |  |  |
| devolverdigital | Official Blogs | `/devolverdigital/blog` | devolverdigital.com/blog |  |
| diershoubing | 新闻 | `/diershoubing/news` | diershoubing.com/ |  |
| dorohedoro | News | `/dorohedoro/news` | dorohedoro.net/news |  |
| ea | APEX Legends 官网资讯 | `/ea/apex-news/zh-hant/game-updates` |  |  |
| elamigos | Releases | `/elamigos/games` |  |  |
| epicgames | Free games | `/epicgames/freegames/en-US/US` |  |  |
| ff14 | FINAL FANTASY XIV (The Lodestone) | `/ff14/global/na/all` |  |  |
| ff14 | 最终幻想 14 国服 | `/ff14/zh/news` | ff.web.sdo.com/web8/index.html |  |
| gamebase | 新聞 | `/gamebase/news` | news.gamebase.com.tw |  |
| gamegene | 资讯 | `/gamegene/news` | news.gamegene.cn/news |  |
| gamersecret | Category | `/gamersecret` |  |  |
| gamersky | 娱乐 | `/gamersky/ent/xz` |  |  |
| gamersky | 资讯 | `/gamersky/news/pc` | gamersky.com |  |
| gamersky | 评测 | `/gamersky/review/pc` | gamersky.com |  |
| gamersky | 用户动态 | `/gamersky/user/4009731/detail` | gamersky.com |  |
| gcores | 文章 | `/gcores/articles` | www.gcores.com |  |
| gcores | 分类 | `/gcores/categories/1/articles` | www.gcores.com |  |
| gcores | 专题 | `/gcores/collections/64/articles` | www.gcores.com |  |
| gcores | 资讯 | `/gcores/news` | www.gcores.com |  |
| gcores | 预告 | `/gcores/radios/preview` | www.gcores.com |  |
| gcores | 标签 | `/gcores/tags/1/articles` | www.gcores.com |  |
| gcores | 机组推荐 | `/gcores/topics/recommend` | www.gcores.com |  |
| gcores | 用户播客 | `/gcores/users/31418/radios` | www.gcores.com | podcast |
| gcores | 用户动态 | `/gcores/users/31418/talks` | www.gcores.com |  |
| gcores | 视频 | `/gcores/videos` | www.gcores.com |  |
| gf-cn | 情报局 | `/gf-cn/news` | sunborngame.com |  |
| hoyolab | Official Announcement | `/hoyolab/news/zh-cn/2/2` | hoyolab.com |  |
| hypergryph/arknights | 回归线 | `/hypergryph/arknights/arktca` |  |  |
| indienova | 文章 | `/indienova/article` |  |  |
| indienova | 专题 | `/indienova/column/52` |  |  |
| indienova | 会员开发游戏库 | `/indienova/usergames` | indienova.com/usergames |  |
| itch | Developer Logs | `/itch/devlog/teamterrible/the-baby-in-yellow` |  |  |
| itch | Posts | `/itch/posts/9539/introduce-yourself` | itch.io |  |
| jump | 游戏折扣 | `/jump/discount/ps5/all` |  |  |
| kisskiss | ブログ | `/kisskiss/blog/DLC` |  |  |
| koyso | 游戏 | `/koyso/0/latest` | koyso.to |  |
| lfsyd | 首页 | `/lfsyd/home` | www.iyingdi.com/ |  |
| lfsyd | 首页（旧版） | `/lfsyd/old_home` | www.iyingdi.com/ |  |
| liquipedia | Dota2 战队最近比赛结果 | `/liquipedia/dota2/matches/Team_Aster` |  |  |
| loltw | 台服新闻 | `/loltw/news` | lol.garena.tw |  |
| mcmod | 最新MOD | `/mcmod/new` | https://www.mcmod.cn |  |
| mihoyo/bbs | 米游社 - 用户关注 | `/mihoyo/bbs/follow-list/77005350` |  |  |
| mihoyo/bbs | 米游社 - 同人榜 | `/mihoyo/bbs/img-ranking/ys/forumType=tongren&cateType=illustration&rankingType=daily` |  |  |
| mihoyo/bbs | 米游社 - 官方公告 | `/mihoyo/bbs/official/2/3/20/` |  |  |
| mihoyo/bbs | 米游社 - 用户帖子 | `/mihoyo/bbs/user-post/77005350` |  |  |
| mihoyo/sr | 崩坏：星穹铁道 | `/mihoyo/sr` | sr.mihoyo.com/news |  |
| mihoyo/ys | 原神 | `/mihoyo/ys` |  |  |
| mihoyo/zzz | 绝区零 | `/mihoyo/zzz` | zzz.mihoyo.com/news |  |
| minecraft | Java Blocked Servers | `/minecraft/blockedservers` | minecraft.net/ |  |
| minecraft | Java Runtimes | `/minecraft/java-runtime` | minecraft.net/ |  |
| minecraft | Java Game Update | `/minecraft/version` | minecraft.net/ |  |
| modrinth | Project versions | `/modrinth/project/sodium/versions` | modrinth.com |  |
| mycard520 | 遊戲新聞 | `/mycard520/category/cardgame` | app.mycard520.com.tw |  |
| nintendo | Nintendo Direct | `/nintendo/direct` | nintendo.com/nintendo-direct/archive |  |
| nintendo | 首页资讯（中国） | `/nintendo/news/china` | nintendoswitch.com.cn/ |  |
| nintendo | News（Hong Kong only） | `/nintendo/news` | nintendo.com.hk/topics |  |
| nintendo | Switch System Update（Japan） | `/nintendo/system-update` | nintendo.co.jp/support/switch/system_update/index.html |  |
| osu/beatmaps | Latest Ranked Beatmap | `/osu/latest-ranked/includeMode=osu&difficultyLimit=L3&difficultyLimit=U7` |  |  |
| osu/beatmaps | Beatmap Packs | `/osu/packs` |  |  |
| priconne-redive | 最新公告 | `/priconne-redive/news` | priconne-redive.jp/news |  |
| ps | PlayStation Monthly Games | `/ps/monthly-games` | www.playstation.com/en-sg/ps-plus/whats-new |  |
| qq/cfhd | 穿越火线 CFHD 专区资讯中心 | `/qq/cfhd/news` | cfhd.cf.qq.com |  |
| qq/lol | 英雄联盟新闻 | `/qq/lol/news` | lol.qq.com |  |
| sega | 世界计划 多彩舞台 ｜ ProjectSekai ｜ プロセカ | `/sega/pjsekai/news` | pjsekai.sega.jp/news/index.html |  |
| steam | News | `/steam/news/958260/english` | steamcommunity.com |  |
| supercell | Game Blog | `/supercell/clashroyale/blog/zh` |  |  |
| taptap | 游戏更新 | `/taptap/changelog/60809/en_US` |  |  |
| taptap | Game | `/taptap/intl/changelog/191001/zh_TW` |  |  |
| taptap | 游戏评价 | `/taptap/review/142793/hot` | www.taptap.io |  |
| taptap | Ratings & Reviews | `/taptap/intl/review/82354/recent` | www.taptap.io |  |
| taptap | 游戏论坛 | `/taptap/topic/142793/official` | www.taptap.io |  |
| tencent/pvp | 新闻中心 | `/tencent/pvp/newsindex/all` |  |  |
| warthunder | News | `/warthunder/news` | warthunder.com/en/news |  |
| wmpvp | 资讯列表 | `/wmpvp/news/1` |  |  |
| xboxfan | 资讯 | `/xboxfan/news` | xboxfan.com/ |  |
| xiaoheihe | 游戏折扣 | `/xiaoheihe/discount/pc` |  |  |
| xiaoheihe | 游戏新闻 | `/xiaoheihe/news` | xiaoheihe.cn |  |
| xiaoheihe | 用户动态 | `/xiaoheihe/user/30664023` | xiaoheihe.cn |  |
| yxdown | 资讯 | `/yxdown/news` | yxdown.com |  |
| yxdown | 精彩推荐 | `/yxdown/recommend` | yxdown.com/ |  |
| yxdzqb | 游戏折扣 | `/yxdzqb/popular_cn` | yxdzqb.com/ |  |
| yxrb | 分类 | `/yxrb/info` |  |  |
| yystv | 游研社 - 分类文章 | `/yystv/category/recommend` |  |  |
| yystv | 游研社 - 全部文章 | `/yystv/docs` | yystv.cn/docs |  |

### government (111)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 81/81rc | 中国人民解放军专业技术人才网 | `/81/81rc/sy/gzdt_210283` | 81rc.81.cn |  |
| beijingprice | 资讯 | `/beijingprice/jgzx/xwzx` | beijingprice.cn |  |
| bjsk | 通用 | `/bjsk/newslist-1394-1474-0` |  |  |
| bjsk | 基金项目管理平台 | `/bjsk/keti` | keti.bjsk.org.cn/indexAction!to_index.action |  |
| bjwxdxh | 最新资讯 | `/bjwxdxh/114` |  |  |
| canada.ca | News by Department | `/canada.ca/news/en/departmentfinance` | www.canada.ca |  |
| casssp | 研究会动态 | `/casssp/news/3` | casssp.org.cn |  |
| cast | 通用 | `/cast/xw/tzgg/ZH` |  |  |
| cde | 首页 | `/cde/news/gzdt` |  |  |
| cde | 信息公开 | `/cde/xxgk/priorityApproval` | www.cde.org.cn |  |
| cde | 指导原则专栏 | `/cde/zdyz/domesticGuide` | www.cde.org.cn |  |
| cffex | 交易所公告 | `/cffex/announcement` | www.cffex.com.cn |  |
| chinacdc | 通用 | `/chinacdc/zxyw` | www.chinacdc.cn |  |
| cisia | 栏目 | `/cisia/9` | www.cisia.org |  |
| cpcey | 消费资讯 | `/cpcey/xwg` |  |  |
| crac | 考试信息 | `/crac/exam` |  |  |
| crac | 最新资讯 | `/crac/2` |  |  |
| dol | e-LandsAnnouncement | `/dol/announce` |  |  |
| dykszx | 考试新闻发布 | `/dykszx/news` | www.dykszx.cn |  |
| gc.ca | News | `/gc.ca/pm/en` | pm.gc.ca |  |
| go/jihs | 感染症発生動向調査週報 | `/go/jihs/idwr/2025` | id-info.jihs.go.jp |  |
| go/mhlw | PDF | `/go/mhlw/pdf/stf/seisakunitsuite/bunya/houkokusuunosuii` | www.mhlw.go.jp |  |
| gov/ah | 科学技术厅 | `/gov/ah/kjt` | kjt.ah.gov.cn |  |
| gov/beijing/bjedu | 教育委员会 - 通用 | `/gov/beijing/bjedu/gh` |  |  |
| gov/beijing/jw | 通知公告 | `/gov/beijing/jw/tzgg` | jw.beijing.gov.cn/tzgg |  |
| gov/caac | 公众留言 | `/gov/caac/cjwt` | caac.gov.cn/HDJL/ |  |
| gov/chinatax | 最新文件 | `/gov/chinatax/latest` | www.chinatax.gov.cn/* |  |
| gov/cmse | 飞行任务 | `/gov/cmse/fxrw` | www.cmse.gov.cn/fxrw |  |
| gov/cn/news | 政府新闻 | `/gov/cn/news/bm` |  |  |
| gov/csrc | 申请事项进度 | `/gov/csrc/auditstatus/9ce91cf2d750ee62de27fbbcb05fa483` |  |  |
| gov/csrc | 政府信息公开 | `/gov/csrc/zfxxgk_zdgk/c101971` | www.csrc.gov.cn |  |
| gov/guizhou | 教育厅 - 通知公告 | `/gov/guizhou/jyt/tzgg` | jyt.guizhou.gov.cn/zwgk/tzgg/ |  |
| gov/hebei | 财政厅 | `/gov/hebei/czt/xwdt` |  |  |
| gov/huizhou/zwgk | 政务公开 | `/gov/huizhou/zwgk/jgdt` |  |  |
| gov/hunan/changsha | 长沙市人民政府 市长信箱 | `/gov/hunan/changsha/major-email` | wlwz.changsha.gov.cn/webapp/cs2020/email/* |  |
| gov/immiau | Immigration and Citizenship - News | `/gov/immiau/news` | immi.homeaffairs.gov.au |  |
| gov/jgjcndrc | 中华人民共和国国家发展和改革委员会价格监测中心 | `/gov/jgjcndrc/1832739866673426433` | www.jgjcndrc.org.cn |  |
| gov/jiangsu/wlt | 文旅局审批公告 | `/gov/jiangsu/wlt` | wlt.jiangsu.gov.cn/ |  |
| gov/jinan/healthcommission | 获取国家医师资格考试通知 | `/gov/jinan/healthcommission/medical_exam_notice` | jnmhc.jinan.gov.cn/* |  |
| gov/lswz | 通用 | `/gov/lswz` | lswz.gov.cn |  |
| gov/maonan | 通用 | `/gov/maonan/zwgk` |  |  |
| gov/mee | 国家核安全局 | `/gov/mee/nnsa/ywdt/hjyw` | nnsa.mee.gov.cn |  |
| gov/mee | 要闻动态 | `/gov/mee/ywdt/hjywnews` | www.mee.gov.cn |  |
| gov/mem | 事故及灾害查处 | `/gov/mem/gk/sgcc/tbzdsgdcbg` | www.mem.gov.cn |  |
| gov/mem | 法定主动公开内容 | `/gov/mem/gk/zfxxgkpt/fdzdgknr` | www.mem.gov.cn |  |
| gov/miit | 文件发布 | `/gov/miit/wjfb/ghs` | www.miit.gov.cn |  |
| gov/miit | 文件公示 | `/gov/miit/wjgs` | www.miit.gov.cn |  |
| gov/miit | 意见征集 | `/gov/miit/yjzj` | miit.gov.cn/gzcy/yjzj/index.html |  |
| gov/miit | 政策解读 | `/gov/miit/zcjd` | www.miit.gov.cn |  |
| gov/miit | 政策文件 | `/gov/miit/zcwj` | www.miit.gov.cn |  |
| gov/moa | 国际合作司 | `/gov/moa/gjs/gzdt` | www.gjs.moa.gov.cn |  |
| gov/moa | 生猪专题重要政策 | `/gov/moa/szcpxx` | www.moa.gov.cn |  |
| gov/moa | 数据 | `/gov/moa/zdscxx` | www.moa.gov.cn |  |
| gov/moe | 新闻 | `/gov/moe/policy_anal` |  |  |
| gov/moe | 司局通知 | `/gov/moe/s78/A13` | www.moe.gov.cn |  |
| gov/mof | 专题 | `/gov/mof/bond` |  |  |
| gov/mof | 关税政策文件 | `/gov/mof/gss` |  |  |
| gov/moj | 立法意见征集 | `/gov/moj/lfyjzj` | www.moj.gov.cn/lfyjzj/lflfyjzj/* |  |
| gov/moj/aac | 最新消息 | `/gov/moj/aac/news` |  |  |
| gov/mot | 通用 | `/gov/mot/jiaotongyaowen` | www.mot.gov.cn |  |
| gov/ndrc | 政府信息公开 | `/gov/ndrc/zfxxgk` | zfxxgk.ndrc.gov.cn |  |
| gov/nea | 司工作进展 | `/gov/nea/sjzz/ghs` | www.nea.gov.cn/ |  |
| gov/nfra | 分类 | `/gov/nfra/915` | www.nfra.gov.cn |  |
| gov/npc | 通用 | `/gov/npc/c183` |  |  |
| gov/pudong | 政务公开 | `/gov/pudong/zwgk` | www.pudong.gov.cn |  |
| gov/safe | 业务咨询 | `/gov/safe/business/beijing` |  |  |
| gov/safe | 投诉建议 | `/gov/safe/complaint/beijing` |  |  |
| gov/samr | 留言咨询 | `/gov/samr/xgzlyhd` | xgzlyhd.samr.gov.cn/gjjly/index |  |
| gov/sh/fgw | 发展和改革委员会 | `/gov/sh/fgw/fgw_zxxxgk` | fgw.sh.gov.cn |  |
| gov/sh/rsj | 职业能力考试院 考试项目 | `/gov/sh/rsj/ksxm` | rsj.sh.gov.cn/ |  |
| gov/sh/wgj | 文旅局审批公告 | `/gov/sh/wgj` | wsbs.wgj.sh.gov.cn/ |  |
| gov/sh/wsjkw/yqtb | 卫健委 疫情通报 | `/gov/sh/wsjkw/yqtb` | wsjkw.sh.gov.cn/ |  |
| gov/shaanxi | 省科学技术厅 | `/gov/shaanxi/kjt` |  |  |
| gov/shenzhen/hrss/szksy | 考试院 | `/gov/shenzhen/hrss/szksy/bmxx/2` | hrss.sz.gov.cn/* |  |
| gov/shenzhen/szlh | 罗湖区人民政府 政务服务 | `/gov/shenzhen/szlh/zwfw/zffw/tzgg` |  |  |
| gov/shenzhen/xxgk | 政府信息公开 | `/gov/shenzhen/xxgk/zfxxgj/tzgg` |  |  |
| gov/shenzhen/zjj | 住房和建设局 | `/gov/shenzhen/zjj/xxgk/tzgg` |  |  |
| gov/shenzhen/zzb | 深圳市委组织部 | `/gov/shenzhen/zzb/tzgg` | zzb.sz.gov.cn/* |  |
| gov/sichuan/deyang | 政府公开信息 | `/gov/sichuan/deyang/govpublicinfo/绵竹市` |  |  |
| gov/sichuan/deyang | 今日绵竹 | `/gov/sichuan/deyang/mztoday/zx` | www.mztoday.gov.cn/* |  |
| gov/suzhou | 政府信息公开文件 | `/gov/suzhou/doc` | www.suzhou.gov.cn/szxxgk/front/xxgk_right.jsp |  |
| gov/suzhou | 政府新闻 | `/gov/suzhou/news/news` | www.suzhou.gov.cn |  |
| gov/taiyuan | 人力资源和社会保障局政府公开信息 | `/gov/taiyuan/rsj/gggs` | rsj.taiyuan.gov.cn/* |  |
| gov/wuhan | 要闻 | `/gov/wuhan/sy/whyw` | wuhan.gov.cn/sy/whyw/ |  |
| gov/xuzhou | 人力资源和社会保障局 | `/gov/xuzhou/hrss` |  |  |
| gov/zhejiang | 通知 | `/gov/zhejiang/gwy/1` | zjks.gov.cn/zjgwy/website/init.htm |  |
| gov/zhengce | 信息稿件 | `/gov/zhengce/govall/orpro=555&notpro=2&search_field=title` | www.gov.cn/ |  |
| gov/zhengce | 政策 | `/gov/zhengce` | www.gov.cn/zhengce/ |  |
| gov/zhengce | 最新文件 | `/gov/zhengce/wenjian` | www.gov.cn/ |  |
| gov/zhengce | 政策文件库 | `/gov/zhengce/zhengceku/bmwj` | www.gov.cn |  |
| hongkong | Press Release | `/hongkong/dh` | dh.gov.hk/ |  |
| icac | Press Releases | `/icac/news/sc` | icac.org.hk |  |
| itsec | 新闻发布 | `/itsec/news` | www.itsec.gov.cn |  |
| mohw | 即時新聞澄清 | `/mohw/clarification` | mohw.gov.tw/ |  |
| njglyy | 员工版教育培训 | `/njglyy/ygbjypx` | njglyy.com/ygb/jypx/jypx.aspx |  |
| nyc | Mayor | `/nyc/mayors-office-news/executive-orders/civic-services` |  |  |
| ornl | All News | `/ornl/all-news` | www.ornl.gov |  |
| parliament | Thailand Parliament Draft of Law | `/parliament/section77` | parliament.go.th |  |
| parliament.uk | Petitions | `/parliament.uk/petitions/all` | petition.parliament.uk |  |
| samd | 资讯信息 | `/samd/news/440` | www.samd.org.cn |  |
| samrdprc | 栏目 | `/samrdprc/xwdt/gzdt` | www.samrdprc.org.cn |  |
| samrdprc | 召回信息 | `/samrdprc/news/xfpzh/xfpgnzh` | www.samrdprc.org.cn |  |
| sara | 新闻资讯 | `/sara/announcement` |  |  |
| scitechvista | 最新文章 | `/scitechvista` |  |  |
| scpta | 通知公告 | `/scpta/news/33` | www.scpta.com.cn |  |
| ssm | 最新消息 | `/ssm/news` | www.ssm.gov.mo/ |  |
| verfghbw | Press releases | `/verfghbw/press` | verfgh.baden-wuerttemberg.de/presse-und-service/pressemitteilungen/ |  |
| whitehouse | News | `/whitehouse/news` | whitehouse.gov |  |
| who | Newsroom | `/who/news-room/feature-stories` | who.int/news |  |
| who | News | `/who/news` | who.int/news |  |
| who | Speeches | `/who/speeches` | who.int/director-general/speeches |  |

### journal (37)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| aeaweb | Journal | `/aeaweb/aer` |  | scihub |
| aip | Journal | `/aip/aapt/ajp` |  | scihub |
| ajcass | 社会学研究 | `/ajcass/shxyj/2024/1` | ajcass.com |  |
| annualreviews | Journal | `/annualreviews/anchem` |  | scihub |
| bioone | Featured articles | `/bioone/featured` | bioone.org/ |  |
| bioone | Journals | `/bioone/journals/acta-chiropterologica` |  |  |
| caareviews | Book Reviews | `/caareviews/book` | caareviews.org/reviews/book |  |
| caareviews | Essays | `/caareviews/essay` | caareviews.org/reviews/essay |  |
| caareviews | Exhibition Reviews | `/caareviews/exhibition` | caareviews.org/reviews/exhibition |  |
| cnki | 作者 | `/cnki/author/丁晓东/中国人民大学` |  |  |
| cnki | 期刊缩写，可以在网址中得到 | `/cnki/journals/debut/LKGP` |  |  |
| cnki | 期刊缩写，可以在网址中得到 | `/cnki/journals/LKGP` |  |  |
| ieee | IEEE Author Articles | `/ieee/author/37264968900/newest` |  | scihub |
| informs | Category | `/informs/mnsc` |  |  |
| mdpi | Journal | `/mdpi/analytica` |  |  |
| mwm | 分类 | `/mwm` |  |  |
| nature | Cover Story | `/nature/cover` | nature.com/ |  |
| nature | Research Highlight | `/nature/highlight` |  | scihub |
| nature | News & Comment | `/nature/news-and-comment/ng` | nature.com/latest-news | scihub |
| nature | Nature News | `/nature/news` | nature.com/latest-news | scihub |
| nature | Latest Research | `/nature/research/ng` | nature.com | scihub |
| nature | Journal List | `/nature/siteindex` | nature.com |  |
| ndss-symposium | Accepted papers | `/ndss-symposium/ndss` | ndss-symposium.org/ |  |
| openalex | Works | `/openalex/s64187185/subfield/2604` | openalex.org |  |
| pacilution | 最新文章 | `/pacilution/latest` |  |  |
| papers | Category | `/papers/category/arxiv/cs.AI` | papers.cool | scihub, native-feed |
| papers | Topic | `/papers/query/Detection` | papers.cool | scihub |
| rsc | Journal | `/rsc/journal/ta` |  |  |
| sciencedirect | Current Issue | `/sciencedirect/journal/journal-of-financial-economics/current` |  |  |
| sciencedirect | Journal | `/sciencedirect/journal/research-policy` |  |  |
| shu | 《社会》杂志当期目录 | `/shu/journals/society/current` | www.shu.edu.cn |  |
| springer | Journal | `/springer/journal/10450` |  |  |
| tctmd | Conference News | `/tctmd/conference-news` | www.tctmd.com/news/conference-news |  |
| telecompaper | News | `/telecompaper/news/mobile/2020/China/News` | telecompaper.com |  |
| telecompaper | Search | `/telecompaper/search/Nokia` | telecompaper.com |  |
| trendingpapers | Trending Papers on arXiv | `/trendingpapers/papers` | trendingpapers.com |  |
| usenix | ;login: | `/usenix/loginonline` |  |  |

### live (12)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| bilibili | 直播分区 | `/bilibili/live/area/207/online` |  |  |
| bilibili | 直播开播 | `/bilibili/live/room/3` |  |  |
| bilibili | 直播搜索 | `/bilibili/live/search/dota/online` |  |  |
| douyu | 直播间开播 | `/douyu/room/24422` | www.douyu.com |  |
| lxixsxa | Latest Discography | `/lxixsxa/disco` | www.lxixsxa.com/ |  |
| lxixsxa | News | `/lxixsxa/info` | www.lxixsxa.com/ |  |
| twitch | Live | `/twitch/live/riotgames` |  |  |
| twitch | Stream Schedule | `/twitch/schedule/riotgames` | www.twitch.tv |  |
| twitch | Channel Video | `/twitch/video/riotgames/highlights` | www.twitch.tv |  |
| yoasobi-music | News & Biography | `/yoasobi-music/info/news` | www.yoasobi-music.jp/ |  |
| yoasobi-music | Live | `/yoasobi-music/live` | www.yoasobi-music.jp/ |  |
| yoasobi-music | Media | `/yoasobi-music/media` | www.yoasobi-music.jp/ |  |

### multimedia (79)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 0xxx | Source | `/0xxx/category=Movie-HD-1080p` | 0xxx.ws |  |
| 163/music | 歌手歌曲 | `/163/music/artist/songs/2116` |  |  |
| 163/music | 歌手专辑 | `/163/music/artist/2116` |  |  |
| 163/music | 电台节目 | `/163/music/djradio/347317067` |  | podcast |
| 163/music | 用户歌单 | `/163/music/user/playlist/45441555` |  |  |
| 1lou | 通用 | `/1lou/forum-2-1` | 1lou.me |  |
| 2048 | 论坛 | `/2048/2` |  | BT |
| 6v123 | 分类 | `/6v123/dy` | www.hao6v.me | BT |
| 6v123 | 最新电影 | `/6v123/latestMovies` | hao6v.com/ | BT |
| 6v123 | 最新电视剧 | `/6v123/latestTVSeries` | hao6v.com/ | BT |
| ajmide | 播客 | `/ajmide/10603594` |  |  |
| apple | 播客 | `/apple/podcast/id1559695855/cn` | www.apple.com/apple-podcasts/ |  |
| bandcamp | Upcoming Live Streams | `/bandcamp/live` | bandcamp.com/live_schedule |  |
| bandcamp | Tag | `/bandcamp/tag/united-kingdom` | bandcamp.com |  |
| bandcamp | Weekly | `/bandcamp/weekly` | bandcamp.com/ |  |
| bfl | Announcements | `/bfl/announcements` | bfl.ai/announcements |  |
| bt0 | 影视资源下载列表 | `/bt0/mv/35575567/2` |  | BT |
| bt0 | 最新资源列表 | `/bt0/tlist/1` | 2bt0.com | BT |
| btbtla | 电影 | 电视剧名称 | `/btbtla/detail/雍正王朝` |  | BT |
| btzj | 分类 | `/btzj` | btbtt20.com/ |  |
| castbox | Channels | `/castbox/channel/Lemonade-Stand-id6776228` |  | podcast |
| chikubi | Category | `/chikubi/category/nipple-lesbian` |  |  |
| chikubi | 最新記事 | `/chikubi` |  |  |
| chikubi | Navigation | `/chikubi` | chikubi.jp |  |
| chikubi | 動画カテゴリー | `/chikubi/nipple-video-category/cat-nipple-video-god` | chikubi.jp |  |
| chikubi | AVメーカー | `/chikubi/nipple-video-maker/nipple-video-maker-nh` | chikubi.jp |  |
| chikubi | Search | `/chikubi/search/ギャップ` | chikubi.jp |  |
| chikubi | Tag | `/chikubi/tag/ドリームチケット` | chikubi.jp |  |
| cntv | 栏目 | `/cntv/TOPC1451528971114112` | navi.cctv.com/ |  |
| coomer | Posts | `/coomer` |  |  |
| domp4 | 剧集订阅 | `/domp4/detail/LBTANI22222I` |  | BT |
| domp4 | 最近更新的电源BT列表 | `/domp4/latest_movie_bt` | www.xlmp4.com/ | BT |
| domp4 | 最近更新 | `/domp4/latest/vod` | www.xlmp4.com/ |  |
| dytt | 分类 | `/dytt/gndy/dyzz` |  | BT |
| fantube | User Posts | `/fantube/r18/creator/miyuu` |  |  |
| iqiyi | 剧集 | `/iqiyi/album/神武天尊-2020-1b4lufwxd7h` |  |  |
| iqiyi | 用户视频 | `/iqiyi/user/video/2289191062` | iq.com |  |
| ixigua | 用户视频投稿 | `/ixigua/user/video/4234740937` | ixigua.com |  |
| jable | Jable 搜索结果 | `/jable/search/みなみ羽琉` |  |  |
| maccms | 最新资源 | `/maccms/moduzy.net/2` |  |  |
| maoyan | 实时票房榜 | `/maoyan/box` |  |  |
| maoyan | 即将上映 | `/maoyan/coming` |  |  |
| maoyan | 正在热映 | `/maoyan/hot` |  |  |
| mixcloud | User | `/mixcloud/dholbach/uploads` |  | podcast |
| mixcloud | Playlist | `/mixcloud/dholbach/playlists/ecclectic-dance` | www.mixcloud.com | podcast |
| musify | Latest | `/musify/en` | musify.club |  |
| musikguru | News | `/musikguru/news` | musikguru.de |  |
| myfans | User Posts | `/myfans/user/secret_japan` | myfans.jp |  |
| newzmz | 指定剧集 | `/newzmz/qEzRyY3v` | newzmz.com/ |  |
| nio | NIO Radio | `/nio/nioradio/5` | nio.com | podcast |
| nyaa | Search Result | `/nyaa/search/psycho-pass` |  | BT |
| otobanana | Cast 音声投稿 | `/otobanana/user/cee16401-96b1-420f-8188-abd4d33093f1/cast` |  | podcast |
| otobanana | Livestream ライブ配信 | `/otobanana/user/cee16401-96b1-420f-8188-abd4d33093f1/livestream` |  |  |
| otobanana | Timeline タイムライン | `/otobanana/user/cee16401-96b1-420f-8188-abd4d33093f1` | otobanana.com | podcast |
| pornhub | Category | `/pornhub/category/popular-with-women` |  |  |
| pornhub | Keyword Search | `/pornhub/search/stepsister` | pornhub.com |  |
| pornhub | Users | `/pornhub/users/pornhubmodels` | pornhub.com |  |
| projectjav | Actress | `/projectjav/actress/rima-arai-22198` | projectjav.com/ |  |
| qingting | 专辑 | `/qingting/channel/293411` |  |  |
| qq88 | 分类 | `/qq88` |  |  |
| radio | 专辑 | `/radio/album/15682090498666` |  | podcast |
| radio | 节目 | `/radio/1552135` |  | podcast |
| radio | 直播 | `/radio/zhibo/1395528` | radio.cn | podcast |
| rule34video | Latest Updates | `/rule34video/latest` |  |  |
| storyfm | 播客 | `/storyfm/episodes` | storyfm.cn/episodes-list | podcast |
| storyfm | 首页 | `/storyfm/index` | storyfm.cn/ |  |
| themoviedb | Collection | `/themoviedb/collection/131292/en-US` |  |  |
| themoviedb | TV Show Episodes | `/themoviedb/tv/70593/seasons/1/episodes/en-US` |  |  |
| themoviedb | TV Show Seasons | `/themoviedb/tv/70593/seasons/en-US` | themoviedb.org |  |
| themoviedb | Sheet | `/themoviedb/tv/top-rated/en-US` | themoviedb.org |  |
| themoviedb | Trending | `/themoviedb/trending/tv/day/en-US` | themoviedb.org |  |
| tingtingfm | 节目 | `/tingtingfm/program/M7VJv6Jj4R` | mobile.tingtingfm.com | podcast |
| u3c3 | Search | `/u3c3/search/新片速递` |  | BT |
| xhamster | Newest Videos by Creator | `/xhamster/faustina-pierre` | xhamster.com/faustina-pierre/newest |  |
| xiaoyuzhou | 播客 | `/xiaoyuzhou/podcast/6021f949a789fca4eff4492c` | xiaoyuzhoufm.com/ |  |
| yyets | 影视资讯 | `/yyets/article` |  |  |
| yyets | 今日播出 | `/yyets/today` | yysub.net/tv/schedule |  |
| zimuxia | 分类 | `/zimuxia` |  |  |
| zimuxia | 剧集 | `/zimuxia/portfolio/我们这一天` | zimuxia.cn |  |

### new-media (318)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 10000link | 新闻 | `/10000link/info/newslists/My01` | info.10000link.com |  |
| 163 | 更新 | `/163/dy/W4983108759592548559` |  |  |
| 163 | 栏目 | `/163/exclusive/qsyk` |  |  |
| 163 | 人间 | `/163/renjian/texie` | 163.com |  |
| 163 | 今日关注 | `/163/today` | wp.m.163.com/163/html/newsapp/todayFocus/index.html |  |
| 163/news | 排行榜 | `/163/news/rank/whole/click/day` |  |  |
| 163/news | 专栏 | `/163/news/special/1` |  |  |
| 199it | 资讯 | `/199it/newly` | 199it.com |  |
| 36kr | 资讯热榜 | `/36kr/hot-list` |  |  |
| 52hrtt | 新闻 | `/52hrtt/global` |  |  |
| 52hrtt | 专题 | `/52hrtt/symposium/F1626082387819` | 52hrtt.com |  |
| 78dm | 分类 | `/78dm/news` | 78dm.net |  |
| aa1 | 每日新闻 | `/aa1/60s/news` | 60s.aa1.cn |  |
| aamacau | 话题 | `/aamacau` | aamacau.com/ |  |
| abmedia | 类别 | `/abmedia/technology-development` |  |  |
| abmedia | 首页最新新闻 | `/abmedia/index` | www.abmedia.io/ |  |
| accessbriefing | Articles | `/accessbriefing/latest/news` | accessbriefing.com |  |
| adquan | 案例库 | `/adquan/case_library` | www.adquan.com |  |
| adquan | 最新文章 | `/adquan` | www.adquan.com |  |
| aeon | Categories | `/aeon/category/philosophy` |  |  |
| aeon | Types | `/aeon/essays` | aeon.co |  |
| agirls | 当前精选主题列表 | `/agirls/topic_list` | agirls.aotter.net/ |  |
| agirls | 精选主题 | `/agirls/topic/AppleWatch` | agirls.aotter.net |  |
| agirls | 分类 | `/agirls/app` | agirls.aotter.net |  |
| agora0 | 零博客 | `/agora0/initium` |  |  |
| agora0 | 共和報 | `/agora0/pen0` | agorahub.github.io/pen0 |  |
| agri | 分类 | `/agri/zx/zxfb` | www.agri.cn |  |
| ai-bot | 每日AI资讯 | `/ai-bot/daily-ai-news` | ai-bot.cn/daily-ai-news |  |
| aibase | AI日报 | `/aibase/daily` | www.aibase.com |  |
| aibase | 发现 | `/aibase/discover` | top.aibase.com |  |
| aibase | 资讯 | `/aibase/news` | www.aibase.com |  |
| aibase | 标签 | `/aibase/topic` | top.aibase.com |  |
| aliresearch | 资讯 | `/aliresearch/information` | aliresearch.com/cn/information |  |
| ally | 世界轨道交通资讯网 | `/ally/rail/hyzix/chengguijiaotong` | rail.ally.net.cn/ |  |
| amz123 | AMZ123 快讯 | `/amz123/kx` | amz123.com/kx |  |
| apple | Newsroom (中国大陆) | `/apple/newsroom` | www.apple.com.cn/newsroom |  |
| appleinsider | Category | `/appleinsider` |  |  |
| asiafruitchina | 果蔬品项 | `/asiafruitchina/categories/all` | asiafruitchina.net |  |
| asiafruitchina | 行业资讯 | `/asiafruitchina/news` | asiafruitchina.net |  |
| bendibao | 焦点资讯 | `/bendibao/news/bj` | bendibao.com/ |  |
| bntnews | Category | `/bntnews/bnt003000000` |  |  |
| c114 | 滚动资讯 | `/c114/roll` | c114.com.cn |  |
| cahkms | 分类 | `/cahkms` | cahkms.org/ |  |
| caus | 分类 | `/caus` |  |  |
| cbndata | 看点 | `/cbndata/information/all` | www.cbndata.com |  |
| cbpanet | 资讯 | `/cbpanet/dzp_news/2/11` | cbpanet.com |  |
| ccagm | 栏目 | `/ccagm/association-news` | www.ccagm.org.cn |  |
| cccmc | 通用 | `/cccmc/ywgg/tzgg` | www.cccmc.org.cn |  |
| ccfa | 分类 | `/ccfa/1` | www.ccfa.org.cn |  |
| ccg | 动态 | `/ccg/news` | www.ccg.org.cn |  |
| cdi | 栏目 | `/cdi` |  |  |
| chaincatcher | 快讯 | `/chaincatcher/news` | chaincatcher.com/news |  |
| chaping | 图片墙 | `/chaping/banner` | chaping.cn/ |  |
| chaping | 资讯 | `/chaping/news/15` | chaping.cn |  |
| chaping | 快讯 | `/chaping/newsflash` | chaping.cn/newsflash |  |
| chiculture | 議題熱話 | `/chiculture/topic` | chiculture.org.hk |  |
| china/finance | Finance News 财经 - 财经新闻 | `/china/finance` |  |  |
| china/news/highlights | News and current affairs 时事新闻 | `/china/news` |  |  |
| china/news/military | Military - Military News 军事 - 军事新闻 | `/china/news/military` | military.china.com/news |  |
| chinaisa | 栏目 | `/chinaisa` |  |  |
| chinania | 分类 | `/chinania/xiehuidongtai/xiehuitongzhi` | www.chinania.org.cn |  |
| chinaventure | 分类 | `/chinaventure/news/78` | chinaventure.com.cn/ |  |
| ciidbnu | 分类 | `/ciidbnu` |  |  |
| cn-healthcare | 首页 | `/cn-healthcare/index` | cn-healthcare.com/ |  |
| cngold | 分类 | `/cngold/news-325` | www.cngold.org.cn |  |
| cnljxh | 栏目 | `/cnljxh/news/10` | www.cnljxh.org.cn |  |
| coindesk | 新闻周刊 | `/coindesk/consensus-magazine` | coindesk.com/ |  |
| consumer | 文章 | `/consumer` | consumer.org.hk/ |  |
| consumer | 消費全攻略 | `/consumer/shopping-guide` | consumer.org.hk |  |
| costar | Press Releases | `/costar/press-releases` | www.costar.com |  |
| cpcaauto | 文章 | `/cpcaauto/news/news` | cpcaauto.com |  |
| ctinews | 話題 | `/ctinews/topic/KDdek5vgXx` | ctinews.com |  |
| cuilingmag | 分类 | `/cuilingmag` | cuilingmag.com |  |
| cyzone | 作者 | `/cyzone/author/1225562` |  |  |
| cyzone | 资讯 | `/cyzone` |  |  |
| cyzone | 标签名称，可在对应标签页 URL 中找到 | `/cyzone/label/创业邦周报` |  |  |
| dahecube | 新闻 | `/dahecube` |  |  |
| dedao | 得到文章 | `/dedao/articles/9` | www.igetget.com |  |
| dedao | 知识城邦 | `/dedao/knowledge` |  |  |
| dedao | 首页 | `/dedao/list/年度日更` | igetget.com/ |  |
| dedao | 用户主页 | `/dedao/user/VkA5OqLX4RyGxmZRNBMlwBrDaJQ9og` | dedao.cn |  |
| deepl | Blog | `/deepl/blog/en` | www.deepl.com |  |
| deepmind | Blog | `/deepmind/blog` | deepmind.com/blog | native-feed |
| dehenglaw | 德恒探索 | `/dehenglaw/CN/paper` | dehenglaw.com |  |
| dgtle | 文章 | `/dgtle/article/0/0` | www.dgtle.com |  |
| dgtle | 兴趣 | `/dgtle/feed` | www.dgtle.com |  |
| dgtle | 鲸闻 | `/dgtle/news/0` | www.dgtle.com |  |
| dgtle | 标签 | `/dgtle/tag/394` | www.dgtle.com |  |
| dgtle | 视频 | `/dgtle/video` | www.dgtle.com |  |
| diandong | 资讯 | `/diandong/news` | diandong.com/news |  |
| diariofruticola | Filtro | `/diariofruticola/filtro/cerezas/71` | diariofruticola.cl |  |
| digitalcameraworld | News | `/digitalcameraworld/news` | digitalcameraworld.com |  |
| disinfo | Publications | `/disinfo/publications` | disinfo.eu/ |  |
| dn | News | `/dn/en-us/news` | dn.com |  |
| duozhi | 分类 | `/duozhi/industry` | www.duozhi.com |  |
| dushu/fuzhou | 樊登福州运营中心 | `/dushu/fuzhou` | www.dushu365.com* |  |
| dx2025 | 分类 | `/dx2025` |  |  |
| efe | Category | `/efe/mundo` |  |  |
| egsea | 快讯 | `/egsea/flash` | egsea.com/news/flash |  |
| eprice | 最新消息 | `/eprice/tw` | eprice.com.tw | native-feed |
| europechinese | 最新 | `/europechinese/latest` | europechinese.blogspot.com/ |  |
| expats | Czech News | `/expats/czech-news/daily-news` | www.expats.cz |  |
| fangchan | 列表 | `/fangchan/list/datalist` | www.fangchan.com |  |
| farmatters | Exclusive | `/farmatters/exclusive` | farmatters.com/news |  |
| fashionnetwork | FashionNetwork 中国 | `/fashionnetwork/cn/lists/0` | fashionnetwork.cn |  |
| focustaiwan | Category | `/focustaiwan` |  |  |
| foresightnews | 文章 | `/foresightnews/article` | foresightnews.pro/ |  |
| foresightnews | 专栏 | `/foresightnews/column/1` | foresightnews.pro/ |  |
| foresightnews | 快讯 | `/foresightnews/news` | foresightnews.pro/news |  |
| fortunechina | 分类 | `/fortunechina` |  |  |
| fuliba | 最新 | `/fuliba/latest` | fuliba2023.net/ |  |
| gcores | 播客 | `/gcores/radios/45` | gcores.com/radios | podcast |
| geekpark | 栏目 | `/geekpark` | geekpark.net |  |
| google | News | `/google/news/Top stories/hl=en-US&gl=US&ceid=US:en` | www.google.com |  |
| grainoil | 分类 | `/grainoil/newsListHome/3` | load.grainoil.com.cn |  |
| grist | Featured | `/grist/featured` | grist.org/ |  |
| grist | Series | `/grist/series/best-of-grist` | grist.org/articles/ |  |
| grist | Topic | `/grist/topic/extreme-heat` | grist.org/articles/ |  |
| guancha | 头条 | `/guancha/headline` | guancha.cn/GuanChaZheTouTiao |  |
| guancha | 首页 | `/guancha` | guancha.cn/ |  |
| guancha | 观学院 | `/guancha/member/recommend` | guancha.cn/ |  |
| guancha | 个人主页文章 | `/guancha/personalpage/243983` | guancha.cn |  |
| guancha | 风闻话题 | `/guancha/topic/110/1` | guancha.cn/ |  |
| harvard/health | Health Blog | `/harvard/health/blog` | www.health.harvard.edu/blog |  |
| hbr | Topic | `/hbr/topic/Leadership/Popular` | hbr.org |  |
| hellobtc | 首页 | `/hellobtc/information/latest` |  |  |
| hellobtc | 科普 | `/hellobtc/kepu/latest` |  |  |
| hellobtc | 快讯 | `/hellobtc/news` | hellobtc.com/news |  |
| hinatazaka46 | Hinatazaka46 Blog 日向坂 46 博客 | `/hinatazaka46/blog` |  |  |
| hinatazaka46 | Hinatazaka46 News 日向坂 46 新闻 | `/hinatazaka46/news` | hinatazaka46.com/s/official/news/list |  |
| hizu | 栏目 | `/hizu` | hizh.cn/ |  |
| hk01 | 热门 | `/hk01/hot` | hk01.com/hot |  |
| hk01 | 即時 | `/hk01/latest` | hk01.com/latest |  |
| houxu | Live | `/houxu/lives/33899` | houxu.app/ |  |
| iehou | 线报 | `/iehou` | iehou.com |  |
| ifanr | 快讯 | `/ifanr/digest` | www.ifanr.com |  |
| ifanr | 首页 | `/ifanr/index` | www.ifanr.com/index |  |
| ifeng | 大风号 | `/ifeng/feng/2583/doc` |  |  |
| ifun/n | 盐选故事分类 | `/ifun/n/category` | n.ifun.cool |  |
| ifun/n | 盐选故事搜索 | `/ifun/n/search/NPC` | n.ifun.cool |  |
| ifun/n | 盐选故事专栏 | `/ifun/n/tag/zhihu` | n.ifun.cool |  |
| imiker | 米课圈精华 | `/imiker/ask/jinghua` | imiker.com/explore/find |  |
| in-en | 新闻 | `/in-en/news/solar` |  |  |
| indianexpress | Section | `/indianexpress/section/explained` | indianexpress.com |  |
| indiansinkuwait | News | `/indiansinkuwait/latest` | indiansinkuwait.com/latest-news |  |
| infoq | 推荐 | `/infoq/recommend` | infoq.cn/ |  |
| infoq | 话题 | `/infoq/topic/1` | infoq.cn |  |
| ithome | 分类资讯 | `/ithome/it` |  |  |
| ithome | 热榜 | `/ithome/ranking/24h` | ithome.com |  |
| ithome | 标签名称，可从网址链接中获取 | `/ithome/tag/win11` | ithome.com |  |
| ithome | 专题 | `/ithome/zt/xijiayi` | ithome.com |  |
| ithome/tw | Feeds | `/ithome/tw/feeds/news` |  |  |
| jbma | Precious Metals Report | `/jbma/report` | jbma.net |  |
| jl1mall | 星林社区 | `/jl1mall/forum/2` | www.jl1mall.com |  |
| junhe | 君合法评 | `/junhe/legal-updates` | junhe.com |  |
| kamen-rider-official | 最新情報 | `/kamen-rider-official/news` | kamen-rider-official.com |  |
| kbs | News | `/kbs/news` | world.kbs.co.kr/ |  |
| kbs | Today | `/kbs/today` | world.kbs.co.kr/ |  |
| kelownacapnews | News | `/kelownacapnews/local-news` | www.kelownacapnews.com |  |
| kepu | 直播回看 | `/kepu/live` | live.kepu.net.cn/replay/index | BT |
| kpopping | News | `/kpopping/news/gender-all/category-all/idol-any/group-any/order` | kpopping.com |  |
| kuwaitlocal | Categorised News | `/kuwaitlocal/article` | kuwaitlocal.com/news/latest |  |
| landiannews | 分类 | `/landiannews/category/sells` | www.landiannews.com |  |
| landiannews | 首页 | `/landiannews` | www.landiannews.com |  |
| landiannews | 标签 | `/landiannews/tag/linux-kernel` | www.landiannews.com |  |
| latepost | 报道 | `/latepost` |  |  |
| leiphone | 业界资讯 | `/leiphone/newsflash` | leiphone.com/ |  |
| logclub | 报告 | `/logclub/lc_report` | logclub.com |  |
| ltaaa | 网站翻译 | `/ltaaa/article` | www.ltaaa.cn |  |
| macfilos | Blog | `/macfilos/blog` | macfilos.com/blog |  |
| medsci | 资讯 | `/medsci` |  |  |
| meishichina | 菜谱 | `/meishichina/recipe` | home.meishichina.com |  |
| meritalk | Latest Articles | `/meritalk/articles` |  |  |
| mirror | User | `/mirror/tingfei.eth` |  |  |
| mittrchina | 首页 | `/mittrchina/index` |  |  |
| mpaypass | 分类 | `/mpaypass/main/policy` |  |  |
| mpaypass | 新闻 | `/mpaypass/news` | mpaypass.com.cn/ |  |
| my-formosa | 首頁 | `/my-formosa` | m.my-formosa.com.tw |  |
| mydrivers | 排行 | `/mydrivers/rank` | m.mydrivers.com/newsclass.aspx |  |
| mygopen | 分類 | `/mygopen` |  |  |
| nautil | Topics | `/nautil/topic/arts` | nautil.us |  |
| news | 新华社新闻 | `/news/xhsxw` | news.cn/xhsxw.htm |  |
| newslaundry | Explainer | `/newslaundry/explainer` |  |  |
| newslaundry | Explains | `/newslaundry/nl-cheatsheet` | newslaundry.com |  |
| newslaundry | NL Collaboration | `/newslaundry/nl-collaborations` | newslaundry.com |  |
| newslaundry | Podcast | `/newslaundry/podcast` | newslaundry.com | podcast |
| newslaundry | Reports | `/newslaundry/reports` | newslaundry.com |  |
| newslaundry | Shot | `/newslaundry/shot` | newslaundry.com |  |
| newslaundry | Subscriber Only | `/newslaundry/subscriber-only` | newslaundry.com |  |
| newsmarket | 分類 | `/newsmarket` |  |  |
| newswav | Latest | `/newswav` |  |  |
| nextapple | 最新新聞 | `/nextapple/realtime/latest` | tw.nextapple.com/ |  |
| ngocn2 | 首页 | `/ngocn2` | ngocn2.org/ |  |
| niaogebiji | 分类目录 | `/niaogebiji/cat/103` | niaogebiji.com/ |  |
| niaogebiji | 今日事 | `/niaogebiji/today` | niaogebiji.com/ |  |
| nltimes | News | `/nltimes/news/top-stories` | nltimes.nl |  |
| nogizaka46 | Nogizaka46 Blog 乃木坂 46 博客 | `/nogizaka46/blog` | blog.nogizaka46.com/s/n46/diary/MEMBER |  |
| nogizaka46 | Nogizaka46 News 乃木坂 46 新闻 | `/nogizaka46/news` | news.nogizaka46.com/s/n46/news/list |  |
| odaily | 活动 | `/odaily/activity` | 0daily.com/activityPage |  |
| odaily | 快讯 | `/odaily/newsflash` | 0daily.com/newsflash |  |
| … | _+118 more_ | | | |

### other (59)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 591 | Rental house | `/591/tw/rent/order=posttime&orderType=desc` |  |  |
| acpaa | 标签名称，默认为重要通知，可在对应标签页 URL 中找到 | `/acpaa` |  |  |
| aflcio | Blog | `/aflcio/blog` | aflcio.org |  |
| alwayscontrol | 最新动态 | `/alwayscontrol/news` | alwayscontrol.com.cn |  |
| apple | Exchange and Repair Extension Programs | `/apple/exchange_repair` |  |  |
| aqara | 社区 | `/aqara/community` |  |  |
| auto-stats | 分类 | `/auto-stats` |  |  |
| baidu | 热搜榜单 | `/baidu/top` | www.baidu.com |  |
| bing | 搜索 | `/bing/search/rss` | cn.bing.com/ |  |
| boc | 外汇牌价 | `/boc/whpj/zs?filter_title=%E8%8B%B1%E9%95%91` | boc.cn/sourcedb/whpj |  |
| ccmn | 调价动态 | `/ccmn/price-adjustment/copper` | www.ccmn.cn |  |
| cdzjryb | 商品住房购房登记 | `/cdzjryb/zw/projectList` | zw.cdzjryb.com/lottery/accept/projectList |  |
| cebbank | 外汇牌价 - 总览 | `/cebbank/quotation/all` | cebbank.com/site/ygzx/whpj/index.html |  |
| cebbank | 外汇牌价 | `/cebbank/quotation/history/usd` |  |  |
| cfachina | 分析师园地 | `/cfachina/servicesupport/analygarden` |  |  |
| cib | 外汇牌价 | `/cib/whpj/xh?filter_title=USD` | cib.com.cn/ |  |
| digitalpolicyalert | Activity Tracker | `/digitalpolicyalert/activity-tracker` | digitalpolicyalert.org |  |
| easynomad | 远程工作列表 | `/easynomad` |  |  |
| eventbrite | Events | `/eventbrite/canada--toronto/all-events` |  |  |
| firefox | Firefox Monitor | `/firefox/breaches` | monitor.firefox.com/ |  |
| fisher-spb | News | `/fisher-spb/news` | fisher.spb.ru/news |  |
| galxe | Quest | `/galxe/quest/MissionWeb3` | app.galxe.com |  |
| gdsrx | 栏目 | `/gdsrx` |  |  |
| google | Alerts | `/google/alerts/RSSHub` |  |  |
| google | Search | `/google/search/rss/zh-CN,zh` | www.google.com |  |
| guduodata | 日榜 | `/guduodata/daily` | guduodata.com/ |  |
| hiring.cafe | Jobs | `/hiring.cafe/jobs/sustainability` |  |  |
| icbc | 外汇牌价 | `/icbc/whpj/zs?filter_title=%E8%8B%B1%E9%95%91` | icbc.com.cn/column/1438058341489590354.html |  |
| instructables | Projects | `/instructables/projects/circuits` | instructables.com/projects |  |
| iqnew | 最近更新 | `/iqnew/latest` | iqnew.com/post/new_100/ |  |
| iresearch | 研究报告 | `/iresearch/report` | www.iresearch.com.cn |  |
| iresearch | 周度市场观察 | `/iresearch/weekly` | www.iresearch.com.cn |  |
| japanpost | Track & Trace Service | `/japanpost/track/EJ123456789JP/en` | trackings.post.japanpost.jp/services/srv/search/ |  |
| ke | 研究成果 | `/ke/researchResults` | www.research.ke.com/researchResults |  |
| kuaidi100 | 快递订单追踪 | `/kuaidi100/track/shunfeng/SF1007896781640/0383` |  |  |
| kuaidi100 | 支持的快递公司列表 | `/kuaidi100/company` | kuaidi100.com/ |  |
| link3 | Link3 Events | `/link3/events` | link3.to |  |
| link3 | Link3 Profile | `/link3/profile/synfutures_defi` | link3.to |  |
| linkedin/cn | Jobs | `/linkedin/cn/jobs/Software` |  |  |
| luma | Events | `/luma/yieldnest` | lu.ma |  |
| naver | 검색 | `/naver/search/all/송소희` | naver.com |  |
| nlc | 读者云平台 | `/nlc/read/电子图书` | read.nlc.cn |  |
| peterwunder | New Badges | `/peterwunder/achievements` | projects.peterwunder.de/achievements |  |
| piyao | 今日辟谣 | `/piyao/jrpy` | piyao.org.cn/jrpy/index.htm |  |
| producthunt | Top Products Launching Today | `/producthunt/today` | www.producthunt.com/ |  |
| qq/fact | 最新辟谣 | `/qq/fact` | vp.fact.qq.com/home |  |
| questn | Community Events | `/questn/community/gmnetwork` | app.questn.com |  |
| questn | Events | `/questn/events` | app.questn.com |  |
| scmp | South China Morning Post - China coronavirus outbreak | `/scmp/coronavirus` |  |  |
| sogou | 特色 LOGO | `/sogou/doodles` |  |  |
| sogou | 搜索 | `/sogou/search/rss` | www.sogou.com |  |
| sustainabilitymag | Articles | `/sustainabilitymag/articles` | sustainabilitymag.com/articles |  |
| tvtropes | Featured | `/tvtropes/featured/today` |  |  |
| ups | Tracking | `/ups/track/1Z78R6790470567520` | ups.com |  |
| urbandictionary | Random words | `/urbandictionary/random` | urbandictionary.com/random.php |  |
| usepanda | Feeds | `/usepanda/feeds/5718e53e7a84fb1901e059cc` |  |  |
| wchscu | 招聘公告 | `/wchscu/recruit` | www.wchscu.cn |  |
| wise | FX Pair Yesterday | `/wise/pair/GBP/USD` | wise.com |  |
| wohnnet | Immobiliensuche |  |  |  |

### picture (43)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 4khd | Category | `/4khd/category/cosplay` | www.4khd.com/ |  |
| 4khd | Latest | `/4khd` | www.4khd.com/ |  |
| 4kup | Category | `/4kup/category/coser` | 4kup.net/ |  |
| 4kup | Latest | `/4kup` | 4kup.net/ |  |
| 4kup | Popular | `/4kup/popular/7` | 4kup.net/ |  |
| 4kup | Tag | `/4kup/tag/asian` | 4kup.net/ |  |
| 8kcos | 最新 | `/8kcos` | 8kcosplay.com/ |  |
| 8kcos | 标签 | `/8kcos/tag/cosplay` | 8kcosplay.com/ |  |
| 95mm | 集合 | `/95mm/category/1` | 95mm.org/ |  |
| 95mm | 分类 | `/95mm/tab/热门` | 95mm.org/ |  |
| 95mm | 标签 | `/95mm/tag/黑丝` | 95mm.org/ |  |
| artstation | Artist Profolio | `/artstation/wlop` | www.artstation.com |  |
| baobua | Category | `/baobua/category/network` | baobua.com/ |  |
| baobua | Latest | `/baobua` | baobua.com/ |  |
| baobua | Search | `/baobua/search/cos` | baobua.com/ |  |
| bjp | 每日一图 | `/bjp/apod` | bjp.org.cn/APOD/today.shtml |  |
| booru | MMDArchive 标签查询 | `/booru/mmda/tags/full_body%20blue_eyes` |  |  |
| cosplaytele | Category | `/cosplaytele/category/cosplay` | cosplaytele.com/ |  |
| cosplaytele | Latest | `/cosplaytele` | cosplaytele.com/ |  |
| cosplaytele | Popular | `/cosplaytele/popular/3` | cosplaytele.com/ |  |
| cosplaytele | Tag | `/cosplaytele/tag/aqua` | cosplaytele.com/ |  |
| dapenti | 主题 | `/dapenti/subject/184` | dapenti.com |  |
| dapenti | 图卦 | `/dapenti/tugua` | dapenti.com |  |
| everia | Images with category | `/everia/category/cosplay` |  |  |
| everia | Latest | `/everia` |  |  |
| everia | Search | `/everia/search/日向坂46` | everia.club |  |
| everia | Images with tag | `/everia/tag/hinatazaka46-日向坂46` | everia.club |  |
| google | Public Albums | `/google/album/msFFnAzKmQmWj76EA` |  |  |
| google | Update | `/google/doodles/zh-CN` |  |  |
| kpopping | Pics | `/kpopping/kpics/gender-male/category-all/idol-any/group-any/order` | kpopping.com |  |
| magnumphotos | Magazine | `/magnumphotos/magazine` | magnumphotos.com/ |  |
| misskon | Posts | `/misskon/posts/search=video&tags_exclude=353,3100&per_page=5` | misskon.com |  |
| misskon | Tag | `/misskon/tag/cosplay` | misskon.com |  |
| misskon | Top k days | `/misskon/top/60` | misskon.com |  |
| nasa | NASA 中文 | `/nasa/apod-cn` | apod.nasa.govundefined |  |
| nasa | Cheng Kung University Mirror | `/nasa/apod-ncku` | apod.nasa.govundefined |  |
| nasa | Astronomy Picture of the Day | `/nasa/apod` | apod.nasa.govundefined |  |
| natgeo | Daily Photo | `/natgeo/dailyphoto` | nationalgeographic.com/photo-of-the-day/* |  |
| natgeo | Daily Selection | `/natgeo/dailyselection` |  |  |
| qipamaijia | 频道 | `/qipamaijia/fuli` | qipamaijia.com/ |  |
| skeb | Skeb | `/skeb/new_art_works` |  |  |
| skeb | Search Results | `/skeb/search/初音ミク` | skeb.jp |  |
| wallhaven | Search | `/wallhaven/search/categories=110&purity=110&sorting=date_added&order=desc` | wallhaven.cc/ |  |

### program-update (80)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 423down | 423Down | `/423down` | 423down.com |  |
| amazfitwatchfaces | Watch Faces | `/amazfitwatchfaces/amazfit-x/fresh` | amazfitwatchfaces.com |  |
| android | SDK Platform Tools release notes | `/android/platform-tools-releases` | developer.android.com/studio/releases/platform-tools |  |
| android | Security Bulletins | `/android/security-bulletin` | source.android.com/docs/security/bulletin/asb-overview |  |
| anytxt | Release Notes | `/anytxt/release-notes` | anytxt.net |  |
| app-center | Release | `/app-center/release/cloudflare/1.1.1.1-windows/beta` | install.appcenter.ms |  |
| app-sales | Category | `/app-sales/highlights` | app-sales.net |  |
| app-sales | Watchlist Charts | `/app-sales/mostwanted` | app-sales.net |  |
| apple | App Update | `/apple/apps/update/us/id408709785` |  |  |
| apple | Security releases | `/apple/security-releases` | support.apple.com |  |
| appstare | Comments | `/appstare/comments/cn/989673964` | appstare.net/ |  |
| appstore | In-App-Purchase Price Drop Alert | `/appstore/iap/us/id953286746` |  |  |
| appstore | Price Drop | `/appstore/price/us/mac/id1152443474` | apps.apple.com/ |  |
| appstore | 每日精品限免 / 促销应用（鲜面连线 by AppSo） | `/appstore/xianmian` | app.so/xianmian |  |
| asus | BIOS | `/asus/bios/RT-AX88U/zh` | www.asus.com |  |
| asus | GPU Tweak | `/asus/gpu-tweak` | asus.com/campaign/GPU-Tweak-III/* |  |
| azul | Downloads | `/azul/downloads` | www.azul.com |  |
| bandisoft | History | `/bandisoft/history/bandizip` | www.bandisoft.com |  |
| bilibili | 更新情报 | `/bilibili/app/android` |  |  |
| brave | Release Notes | `/brave/latest` | brave.com/latest |  |
| chocolatey | Package | `/chocolatey/packages/microsoft-edge` | community.chocolatey.org |  |
| civitai | Latest models | `/civitai/models` | civitai.com/ |  |
| claude | Code Changelog | `/claude/code/changelog` | code.claude.com |  |
| cpuid | News | `/cpuid/news` | cpuid.com/news.html |  |
| cursor | Changelog | `/cursor/changelog` | cursor.com |  |
| daum | Potplayer Update History | `/daum/potplayer` | potplayer.daum.net |  |
| diskanalyzer | What | `/diskanalyzer/whats-new` | diskanalyzer.com/whats-new |  |
| dockerhub | Image New Build | `/dockerhub/build/diygod/rsshub/latest` |  |  |
| dockerhub | Image New Tag | `/dockerhub/tag/library/mariadb` | hub.docker.com |  |
| eagle | Changelog | `/eagle/changelog/en` |  |  |
| f-droid | App Update | `/f-droid/apprelease/com.termux` |  |  |
| firecore | Release Notes | `/firecore/ios` |  |  |
| firefox | Add-ons Update | `/firefox/addons/rsshub-radar` |  |  |
| fosshub | Software Update | `/fosshub/qBittorrent` |  |  |
| gitkraken | Release Notes | `/gitkraken/release-note` | help.gitkraken.com/gitkraken-desktop/current/ |  |
| gofans | 最新限免 / 促销应用 | `/gofans` |  |  |
| google | Extension Update | `/google/chrome/extension/kefjpfngnndepjbopdmoebkipbgkggaa` |  |  |
| google | Jules Changelog | `/google/jules/changelog` | jules.google/docs/changelog/ |  |
| greasyfork | Script Feedback | `/greasyfork/scripts/431691-bypass-all-shortlinks/feedback` |  |  |
| greasyfork | Script Update | `/greasyfork/en/google.com` | greasyfork.org |  |
| greasyfork | Script Version History | `/greasyfork/scripts/431691-bypass-all-shortlinks/versions` | greasyfork.org |  |
| ifi-audio | Download Hub | `/ifi-audio/download/1503007035/44472` |  |  |
| imagemagick | Changelog | `/imagemagick/changelog` | imagemagick.org/script/download.php |  |
| iplaysoft | 分类 | `/iplaysoft/category/system` | www.iplaysoft.com |  |
| iplaysoft | 首页 | `/iplaysoft` | www.iplaysoft.com |  |
| iplaysoft | 标签 | `/iplaysoft/tag/windows` | www.iplaysoft.com |  |
| kiro | Changelog | `/kiro/changelog` | kiro.dev |  |
| kovidgoyal/kitty | Changelog | `/kovidgoyal/kitty/changelog` | sw.kovidgoyal.net/kitty/changelog/ |  |
| lenovo | 驱动 | `/lenovo/drive/PF3WRD2G` |  |  |
| lineageos | Changes | `/lineageos/changes` | download.lineageos.org |  |
| lrepacks | REPACK скачать | `/lrepacks` | lrepacks.net |  |
| macupdate | Update | `/macupdate/app/11942` |  |  |
| microsoft | Addons Update | `/microsoft/edge/addon/gangkeiaobmjcjokiofpkfpcobpbmnln` |  |  |
| microsoft | Product tags in mcr.microsoft.com | `/microsoft/mcr/product/dotnet/framework/runtime` |  |  |
| neatdownloadmanager | Download | `/neatdownloadmanager/download` | neatdownloadmanager.com/index.php |  |
| nextjs | Blog | `/nextjs/blog` |  |  |
| notateslaapp | Tesla Software Updates | `/notateslaapp/ota` | notateslaapp.com/software-updates/history |  |
| notion | Release | `/notion/release` | notion.so/releases |  |
| oo-software | Changelog | `/oo-software/changelog/shutup10` |  |  |
| openai | ChatGPT Atlas - Release Notes | `/openai/chatgpt-atlas/release-notes` |  |  |
| openai | ChatGPT - Release Notes | `/openai/chatgpt/release-notes` |  |  |
| postman | Release Notes | `/postman/release-notes` | postman.com/downloads/release-notes |  |
| putty | Change Log | `/putty/changes` | www.chiark.greenend.org.uk/~sgtatham/putty/changes.html |  |
| qbittorrent | News | `/qbittorrent/news` | qbittorrent.org/news.php |  |
| raycast | Changelog | `/raycast/changelog` |  |  |
| remnote | Changelog | `/remnote/changelog` | remnote.com/changelog |  |
| scoop | Apps | `/scoop/apps` | scoop.sh |  |
| sony | Software Downloads | `/sony/downloads/product/nw-wm1am2` |  |  |
| sourceforge | Software | `/sourceforge/topic=artificial-intelligence&os=windows` |  |  |
| syosetu | なろう小説 API の更新履歴 | `/syosetu/dev` | dev.syosetu.com |  |
| tencent/qq/sdk | 更新日志 | `/tencent/qq/sdk/changelog/iOS` |  |  |
| tradingview | Desktop releases and release notes | `/tradingview/desktop` | tradingview.com/support/solutions/43000673888-tradingview-desktop-releases-and-release-notes/ |  |
| typora | Dev Release Changelog | `/typora/changelog/dev` | support.typora.io/ |  |
| typora | Changelog | `/typora/changelog` | support.typora.io/ |  |
| unraid | Community Apps | `/unraid/community-apps` | unraid.net/community/apps |  |
| wdc | Download | `/wdc/download/279` |  |  |
| webcatalog | Changelog | `/webcatalog/changelog` | desktop.webcatalog.io/en/changelog |  |
| winstall | Apps Update | `/winstall/Mozilla.Firefox` | winstall.app |  |
| wizfile | Version History | `/wizfile/updates` | antibody-software.com/wizfile/download |  |
| zotero | Version History | `/zotero/versions` | zotero.org/ |  |

### programming (157)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 30secondsofcode | Category and Subcategory | `/30secondsofcode/category/css/interactivity` |  |  |
| 30secondsofcode | New & Popular Snippets | `/30secondsofcode/latest` | www.30secondsofcode.org |  |
| aijishu | 名字，取自URL | `/aijishu/channel/ai` |  |  |
| alistapart | Topics | `/alistapart/application-development` | alistapart.com/articles/ |  |
| aliyun | 数据库内核月报 | `/aliyun/database_month` | mysql.taobao.org/monthly |  |
| aliyun | 公告 | `/aliyun/notice` | developer.aliyun.com |  |
| aliyun/developer | 开发者社区 - 主题 | `/aliyun/developer/group/alitech` |  |  |
| anquanke | 分类订阅 | `/anquanke/week` |  |  |
| atcoder | Contests Archive | `/atcoder/contest` |  |  |
| atcoder | Posts | `/atcoder/post` | atcoder.jp |  |
| augmentcode | Blog | `/augmentcode/blog` | augmentcode.com |  |
| bbcnewslabs | News | `/bbcnewslabs/news` | bbcnewslabs.co.uk/ |  |
| bestblogs | 文章列表 | `/bestblogs/feeds/featured` |  |  |
| bestblogs | 精选推送 | `/bestblogs/newsletter` | www.bestblogs.dev |  |
| bestofjs | Monthly Rankings | `/bestofjs/rankings/monthly` | bestofjs.org/rankings/monthly |  |
| bitbucket | Commits | `/bitbucket/commits/blaze-lib/blaze` |  |  |
| bitbucket | Tags | `/bitbucket/tags/blaze-lib/blaze` | bitbucket.com |  |
| bitmovin | Blog | `/bitmovin/blog` | bitmovin.com/blog |  |
| chlinlearn | 值得一读技术博客 | `/chlinlearn/daily-blog` |  |  |
| claude | Blog | `/claude/blog` | claude.com/blog |  |
| cloudflarestatus | Status | `/cloudflarestatus` | www.cloudflarestatus.com |  |
| cncf | Category | `/cncf` |  |  |
| cockroachlabs | Blogs | `/cockroachlabs/blog/engineering` |  |  |
| codefather | 帖子 | `/codefather/posts` | www.codefather.cn |  |
| codefather | 问答 | `/codefather/questions` | www.codefather.cn |  |
| codeforces | Latest contests | `/codeforces/contests` | www.codeforces.com/contests |  |
| codeforces | Recent actions | `/codeforces/recent-actions` | codeforces.com/recent-actions |  |
| cognition | Blog | `/cognition/blog` | cognition.com/blog |  |
| css-tricks | Articles | `/css-tricks/articles` |  |  |
| css-tricks | CSS Guides | `/css-tricks/collections/2` |  |  |
| css-tricks | Popular this month | `/css-tricks/popular` | css-tricks.com |  |
| dangdang | 公告 | `/dangdang/notice/1` | open.dangdang.com |  |
| dbaplus | 资讯 | `/dbaplus/news/9` | dbaplus.cn |  |
| deeplearning | The Batch | `/deeplearning/the-batch` | www.deeplearning.ai |  |
| deepseek | 新闻 | `/deepseek/news` | api-docs.deepseek.com |  |
| dev.to | Trending Guides | `/dev.to/guides` | dev.to |  |
| dev.to | Top Posts | `/dev.to/top/week` | dev.to/top |  |
| devtrium | Official Blogs | `/devtrium` | devtrium.com |  |
| dewu | 平台公告 | `/dewu/declaration/1010580020` |  |  |
| dewu | 技术博客 | `/dewu/techblog` | dewu.com |  |
| duckdb | 新闻 | `/duckdb/news` | duckdb.org |  |
| elecfans | 文章 | `/elecfans/article/special` |  |  |
| elecfans | 资料 | `/elecfans/soft/special` | www.elecfans.com |  |
| engineering | Tag | `/engineering/tag/javascript` | engineering.fyi |  |
| gihyo | Series | `/gihyo/list/group/Ubuntu-Weekly-Recipe` |  |  |
| gitcode/repos | 仓库提交 | `/gitcode/commits/openharmony-sig/flutter_flutter` |  |  |
| gitee/repos | 仓库提交 | `/gitee/commits/y_project/RuoYi` |  |  |
| gitee/repos | 仓库动态 | `/gitee/events/y_project/RuoYi` |  |  |
| gitee/repos | 仓库 Releases | `/gitee/releases/y_project/RuoYi` |  |  |
| gitee/users | 用户公开动态 | `/gitee/events/y_project` |  |  |
| github | User Activities | `/github/activity/DIYgod` |  | native-feed |
| github | Github Advisory Database RSS | `/github/advisor/data/reviewed/composer` |  |  |
| github | Repo Branches | `/github/branches/DIYgod/RSSHub` |  |  |
| github | Repo Contributors | `/github/contributors/DIYgod/RSSHub` |  |  |
| github | User Followers | `/github/user/followers/HenryQW` |  |  |
| github | Gist Commits | `/github/gist/d2c152bb7179d07015f336b1a0582679` |  |  |
| github | Repo Pull Requests | `/github/pull/DIYgod/RSSHub` | github.com |  |
| github | Repo Pulse | `/github/pulse/DIYgod/RSSHub` | github.com |  |
| github | User Repo | `/github/repos/DIYgod` | github.com |  |
| github | Search Result | `/github/search/RSSHub/bestmatch/desc` | github.com |  |
| github | Topic name, which can be found in the URL of the corresponding [Topics Page](https://github.com/topics/framework) | `/github/topics/framework` | github.com/topics |  |
| github | Wiki History | `/github/wiki/flutter/flutter/Roadmap` | github.com |  |
| gitpod | Blog | `/gitpod/blog` | gitpod.io/blog |  |
| gitpod | Changelog | `/gitpod/changelog` | gitpod.io/changelog |  |
| gitstar-ranking | Ranking | `/gitstar-ranking/repositories` | gitstar-ranking.com |  |
| gocn | 招聘 | `/gocn/jobs` | gocn.vip/ |  |
| gocn | 最新动态 | `/gocn/news` | gocn.vip/ |  |
| gocn | 每日新闻 | `/gocn/topics` | gocn.vip/ |  |
| hackernews | Stories | `/hackernews/threads/comments_list/dang` |  |  |
| hacking8 | 信息流 | `/hacking8` |  |  |
| hackmd | Profile | `/hackmd/profile/hackmd` | hackmd.io |  |
| hellogithub | 文章 | `/hellogithub/article` |  |  |
| hellogithub | 开源项目 | `/hellogithub/home` |  |  |
| hex-rays | Hex-Rays News | `/hex-rays/news` | hex-rays.com/ |  |
| huawei/developer/harmonyos | HarmonyOS 示例代码 | `/huawei/developer/harmonyos/sample-code` |  |  |
| huggingface | Community Articles | `/huggingface/blog-community` | huggingface.co/blog/community |  |
| huggingface | 中文博客 | `/huggingface/blog-zh` | huggingface.co/blog/zh |  |
| huggingface | 英文博客 | `/huggingface/blog` | huggingface.co/blog |  |
| huggingface | Daily Papers | `/huggingface/daily-papers/week/50` | huggingface.co/papers |  |
| huggingface | Group Models | `/huggingface/models/deepseek-ai` | huggingface.co |  |
| huggingface | User Likes Activity | `/huggingface/activity/dotwee/likes` | huggingface.co |  |
| inceptionlabs | Blog | `/inceptionlabs/blog` | inceptionlabs.ai/blog |  |
| infoq | Presentations | `/infoq/presentations` | www.infoq.com |  |
| issuehunt | Project Funded | `/issuehunt/funded/DIYgod/RSSHub` |  |  |
| jinritemai | 平台公告 | `/jinritemai/docs/19` |  |  |
| joshwcomeau | Articles and Tutorials | `/joshwcomeau/latest/css` |  |  |
| joshwcomeau | Popular Content | `/joshwcomeau/popular` | www.joshwcomeau.com |  |
| juejin | AI 编程 | `/juejin/aicoding` | aicoding.juejin.cn |  |
| juejin | 小册 | `/juejin/books` | juejin.cn/books |  |
| juejin | 分类 | `/juejin/category/frontend` |  |  |
| juejin | 单个收藏夹 | `/juejin/collection/6845243180586123271` |  |  |
| juejin | 收藏集 | `/juejin/collections/1697301682482439` |  |  |
| juejin | 专栏 | `/juejin/column/6960559453037199391` |  |  |
| juejin | 用户动态 | `/juejin/dynamic/3051900006845944` |  |  |
| juejin | 沸点 | `/juejin/pins/6824710202487472141` | juejin.cn |  |
| juejin | 用户文章 | `/juejin/posts/3051900006845944` | juejin.cn |  |
| juejin | 标签 | `/juejin/tag/JavaScript` | juejin.cn |  |
| juejin | 热门 | `/juejin/trending/ios/monthly` | juejin.cn |  |
| kiro | Blog | `/kiro/blog` | kiro.dev |  |
| konghq | 博客最新文章 | `/konghq/blog-posts` | konghq.com/blog/* |  |
| lancedb | Blog | `/lancedb/blog` | lancedb.com/blog |  |
| lanqiao | 作者发布的课程 | `/lanqiao/author/1701267` |  |  |
| learnblockchain | 文章 | `/learnblockchain/posts/DApp/newest` | learnblockchain.cn |  |
| leetcode | Articles | `/leetcode/articles` | leetcode.com/articles |  |
| luogu | 比赛列表 | `/luogu/contest` | luogu.com.cn/contest/list |  |
| luogu | 日报 | `/luogu/daily` | luogu.com.cn/discuss/47327 |  |
| luogu | 用户 UID | `/luogu/user/article/1` | luogu.com.cn |  |
| luogu | 博客名称 | `/luogu/user/blog/ftiasch` | luogu.com.cn |  |
| luogu | 用户动态 | `/luogu/user/feed/1` | luogu.com.cn |  |
| manus | Blog | `/manus/blog` | manus.im |  |
| maven | Maven Central Feed | `/maven/central/org.springframework/spring-core` | central.sonatype.com/ | native-feed |
| meituan | 技术团队博客 | `/meituan/tech` | tech.meituan.com |  |
| modb | 合辑 | `/modb/topic/44158` | modb.pro |  |
| modelscope | DevPress 官方社区 | `/modelscope/community` | community.modelscope.cn/ |  |
| modelscope | 数据集 | `/modelscope/datasets` | modelscope.cn/datasets |  |
| modelscope | 研习社 | `/modelscope/learn` | www.modelscope.cn/learn |  |
| modelscope | 模型库 | `/modelscope/models` | modelscope.cn/models |  |
| modelscope | 创空间 | `/modelscope/studios` | modelscope.cn/studios |  |
| mysql | Release Notes | `/mysql/release/8.0` | dev.mysql.com |  |
| nodejs | News | `/nodejs/blog` |  | native-feed |
| openai | News | `/openai/news` | openai.com |  |
| openai | Research | `/openai/research` | openai.com |  |
| oschina | 专栏 | `/oschina/column/14` | www.oschina.net |  |
| oschina | 活动 | `/oschina/event` | www.oschina.net |  |
| oschina | 资讯 | `/oschina/news` | oschina.net |  |
| oschina | 问答主题 | `/oschina/topic/weekly-news` | oschina.net |  |
| oschina | 用户博客 | `/oschina/u/3920392` | oschina.net |  |
| oshwhub | 开源广场 | `/oshwhub/explore` | oshwhub.com |  |
| python | Active Python Releases | `/python/release` | www.python.org |  |
| quicker | 讨论区 | `/quicker/qa` | getquicker.net |  |
| quicker | 动作分享 | `/quicker/share/Recent` | getquicker.net |  |
| quicker | 用户更新 | `/quicker/user/Actions/3-CL` | getquicker.net |  |
| qwen | Blog | `/qwen/blog` |  |  |
| raspberrypi | Official Magazine | `/raspberrypi/magazine` | magazine.raspberrypi.com |  |
| rockthejvm | Article | `/rockthejvm/articles` | rockthejvm.com |  |
| rustcc | 招聘 | `/rustcc/jobs` | rustcc.cn/ |  |
| sec-wiki | 最新周刊 | `/sec-wiki/weekly` | www.sec-wiki.com |  |
| secrss | 作者 | `/secrss/author/网络安全威胁和漏洞信息共享平台` |  |  |
| secrss | 分类 | `/secrss/category/产业趋势` |  |  |
| segmentfault | 频道名称，在频道 URL 可以找到 | `/segmentfault/channel/frontend` |  |  |
| sketis/isabelle-dev/blog | Isabelle Development Blogs | `/sketis/isabelle-dev/blog/1` | isabelle-dev.sketis.net |  |
| smashingmagazine | Category | `/smashingmagazine/react` | smashingmagazine.com/articles/ |  |
| studygolang | 板块 | `/studygolang/go/daily` |  |  |
| studygolang | 招聘 | `/studygolang/jobs` |  |  |
| studygolang | 周刊 | `/studygolang/weekly` | studygolang.com |  |
| sycl | Feeds | `/sycl/news` |  |  |
| tailwindcss | Blog | `/tailwindcss/blog` |  |  |
| taobao | 数据库内核月报 | `/taobao/mysql/monthly` | mysql.taobao.org |  |
| thinkingmachines | News | `/thinkingmachines/news` | thinkingmachines.ai/news |  |
| tidb | 专栏分类 | `/tidb/blog/c/latest` | tidb.net |  |
| visualstudio | Code Blog | `/visualstudio/code/blog` | code.visualstudio.com | native-feed |
| warp | Blog | `/warp/blog` | warp.dev | native-feed |
| wechat | 公众平台系统公告栏目 | `/wechat/announce` | mp.weixin.qq.com/cgi-bin/announce |  |
| windsurf | Blog | `/windsurf/blog` | windsurf.com |  |
| windsurf | Changelog | `/windsurf/changelog` | windsurf.com |  |
| zaozao | 文章 | `/zaozao/article/quality` |  |  |
| zed | Blog | `/zed/blog` | zed.dev | native-feed |

### reading (37)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 51read | 章节 | `/51read/article/152685` | m.51read.org |  |
| 56kog | 分类 | `/56kog/class/1_1` |  |  |
| 56kog | 榜单 | `/56kog/top/weekvisit` | 56kog.com |  |
| 69shu | 章节 | `/69shu/article/47117` | www.69shuba.cx |  |
| aisixiang | 栏目 | `/aisixiang/column/722` |  |  |
| aisixiang | 思想库（专栏） | `/aisixiang/thinktank/WuQine/论文` | aisixiang.com |  |
| aisixiang | 专题 | `/aisixiang/zhuanti/211` | aisixiang.com |  |
| banshujiang | 分类 | `/banshujiang/other/人工智能` | banshujiang.cn |  |
| bookfere | 分类 | `/bookfere/skills` |  |  |
| ciweimao | 章节 | `/ciweimao/chapter/100043404` |  |  |
| freecomputerbooks | Book List | `/freecomputerbooks/compscAlgorithmBooks` |  |  |
| gmcmonline | 中国海关 | `/gmcmonline/chinacustoms` | chinacustoms.gmcmonline.com |  |
| hameln | chapter | `/hameln/chapter/264928` |  |  |
| hbooker | 章节 | `/hbooker/chapter/100113279` |  |  |
| inoreader | RSS | `/inoreader/rss/1005137674/user-favorites` | inoreader.com |  |
| jjwxc | 作者最新作品 | `/jjwxc/author/4364484` |  |  |
| jjwxc | 作品章节 | `/jjwxc/book/7013024` |  |  |
| literotica | New Stories | `/literotica/new` | literotica.com/ |  |
| magazinelib | Latest Magazine | `/magazinelib/latest-magazine/new+yorker` |  |  |
| nautiljon | France manga releases | `/nautiljon/releases/manga` | nautiljon.com |  |
| penguin-random-house | Articles | `/penguin-random-house/articles` | penguinrandomhouse.com/articles |  |
| penguin-random-house | Book Lists | `/penguin-random-house/the-read-down` | penguinrandomhouse.com/the-read-down |  |
| sfacg | 章节 | `/sfacg/novel/chapter/672431` | book.sfacg.com |  |
| sobooks | 归档 | `/sobooks/date/2020-11` |  |  |
| sobooks | 首页 | `/sobooks` |  |  |
| sobooks | 标签 | `/sobooks/tag/小说` | sobooks.net |  |
| syosetu | Novel Updates | `/syosetu/n9292ii` |  |  |
| syosetu | R18 Rankings | `/syosetu/rankingr18/noc/daily_total?limit=50` | syosetu.com/site/group |  |
| syosetu | Rankings | `/syosetu/ranking/list/daily_total?limit=50` | yomou.syosetu.com/rank/top |  |
| syosetu | Search | `/syosetu/search/noc/word=ハーレム&notword=&type=r&mintime=&maxtime=&minlen=30000&maxlen=&min_globalpoint=&max_globalpoint=&minlastup=&maxlastup=&minfirstup=&maxfirstup=&isgl=1&notbl=1&order=new?limit=5` | syosetu.com |  |
| tongli | 新聞 | `/tongli/news/6` | tongli.com.tw |  |
| wdfxw | 免费区 | `/wdfxw/bookfree` | www.wdfxw.net |  |
| wenku8 | 最新卷 | `/wenku8/volume/1163` | www.wenku8.net |  |
| xbookcn | 短篇 | `/xbookcn/精选作品` |  |  |
| yomujp | 等级 | `/yomujp/n1` | yomujp.com/ |  |
| zongheng | 章节更新 | `/zongheng/detail/1366535` | www.zongheng.com |  |
| zxcs | 小说列表 | `/zxcs/novel/jinqigengxin` | zxcs.click |  |

### shopping (51)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 0818tuan | 分类 | `/0818tuan` |  |  |
| 5music | 新貨上架 | `/5music/new-releases` | www.5music.com.tw/New_releases.asp |  |
| arcteryx | Regear New Arrivals | `/arcteryx/regear/new-arrivals` | regear.arcteryx.com/shop/new-arrivals |  |
| bellroy | New Releases | `/bellroy/new-releases` | bellroy.com/collection/new-releases |  |
| bookwalker | 搜尋 | `/bookwalker/search/order=sell_desc&s=34` | www.bookwalker.com.tw |  |
| ccreports | 要闻 | `/ccreports/article` | www.ccreports.com.cn/ |  |
| coolbuy | 产品 | `/coolbuy` | coolbuy.com |  |
| coolpc | 促銷&開箱 | `/coolpc/news` | www.coolpc.com.tw/ |  |
| duozhuayu | 搜索结果 | `/duozhuayu/search/JavaScript` | duozhuayu.com |  |
| furstar | 已经出售的角色列表 | `/furstar/archive/cn` |  |  |
| furstar | 画师列表 | `/furstar/artists/cn` | furstar.jp/ |  |
| furstar | 最新售卖角色列表 | `/furstar/characters/cn` |  |  |
| guangdiu | 九块九 | `/guangdiu/cheaps/k=clothes` |  |  |
| guangdiu | 国内折扣 / 海外折扣 | `/guangdiu/k=daily` |  |  |
| guangdiu | 一小时风云榜 | `/guangdiu/rank` | guangdiu.com/rank |  |
| guangdiu | 关键字搜索 | `/guangdiu/search/q=百度网盘` | guangdiu.com |  |
| gumroad | Products | `/gumroad/afkmaster/Eve10` |  |  |
| ikea/cn | 中国 - 会员特惠 | `/ikea/cn/family_offers` | ikea.cn/cn/zh/offers/family-offers |  |
| ikea/cn | 中国 - 低价优选 | `/ikea/cn/low_price` | ikea.cn/cn/zh/campaigns/wo3-men2-de-chao1-zhi2-di1-jia4-pub8b08af40 |  |
| ikea/cn | 中国 - 当季新品推荐 | `/ikea/cn/new` | ikea.cn/cn/zh/new/ |  |
| ikea/gb | UK - New Product Release | `/ikea/gb/new` | ikea.com/gb/en/new/new-products/ |  |
| ikea/gb | UK - Offers | `/ikea/gb/offer` | ikea.com/gb/en/offers |  |
| jd | 商品价格 | `/jd/price/526835` | item.jd.com |  |
| kleinanzeigen | Search | `/kleinanzeigen/search/category=PCs&location=Berlin&radius=20` | www.kleinanzeigen.de |  |
| ktown4u | Get the products on sale | `/ktown4u/artistBrandlist/234590/1723449` |  |  |
| mercari | 关键词 | `/mercari/create_time/desc/default/ふもふも` | jp.mercari.com |  |
| mercari | Search | `/mercari/search/keyword=シャツ&7bd3eacc-ae45-4d73-bc57-a611c9432014=340258ac-e220-4722-8c35-7f73b7382831` | jp.mercari.com |  |
| mi | 小米众筹 | `/mi/crowdfunding` |  |  |
| myfigurecollection | Activity | `/myfigurecollection/activity` | zh.myfigurecollection.net/browse |  |
| myfigurecollection | 圖片 | `/myfigurecollection/potd` | zh.myfigurecollection.net/browse |  |
| mymusicsheet | User Sheets | `/mymusicsheet/user/sheets/HalcyonMusic/USD/1` | mymusicfive.com |  |
| patagonia | New Arrivals | `/patagonia/new-arrivals/mens` | patagonia.com |  |
| shcstheatre | 节目列表 | `/shcstheatre/programs` | www.shcstheatre.com/Program/programList.aspx |  |
| shoac | 演出月历 | `/shoac/recent-show` | shoac.com.cn/ |  |
| shopback | Store | `/shopback/shopee-mart` | shopback.com.tw |  |
| showstart | 按音乐人 - 演出更新 | `/showstart/artist/301783` |  |  |
| showstart | 按厂牌 - 演出更新 | `/showstart/brand/34707` |  |  |
| showstart | 按城市 - 演出更新 | `/showstart/event/571/3` |  |  |
| showstart | 演出搜索 | `/showstart/search/live` | www.showstart.com |  |
| showstart | 按场地 - 演出更新 | `/showstart/site/3583` | www.showstart.com |  |
| snowpeak | New Arrivals(USA) | `/snowpeak/us/new-arrivals` | snowpeak.com/collections/new-arrivals |  |
| taobao | 众筹项目 | `/taobao/zhongchou/all` | taobao.com |  |
| tesla | 权益中心 | `/tesla/cx/生活方式/北京` |  |  |
| tesla/price | 价格 | `/tesla/price` | tesla.cn/model3/design |  |
| thegadgetflow | Category | `/thegadgetflow/cool-gadgets-gifts` | thegadgetflow.com |  |
| uniqlo | New Arrivals | `/uniqlo/new/sg/men` | www.uniqlo.com |  |
| xianbao | 线板酷 | `/xianbao` | new.xianbao.fun |  |
| xiaomiyoupin | 小米有品众筹 | `/xiaomiyoupin/crowdfunding` | xiaomiyoupin.com/ |  |
| xiaomiyoupin | 小米有品每日上新 | `/xiaomiyoupin/latest` | xiaomiyoupin.com/ |  |
| zagg | New Arrivals | `/zagg/new-arrivals/brand=164&cat=3038,3041` | zagg.com |  |
| zhuwang | 全国今日生猪价格 | `/zhuwang/zhujia` | zhujia.zhuwang.cc/ |  |

### social-media (137)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| bilibili | UP 主图文 | `/bilibili/user/article/334958638` |  |  |
| bilibili | 歌单 | `/bilibili/audio/10624` |  |  |
| bilibili | 入站必刷 | `/bilibili/precious` |  |  |
| bilibili | UP 主投币视频 | `/bilibili/user/coin/208259` |  |  |
| bilibili | 视频弹幕 | `/bilibili/video/danmaku/BV1vA411b7ip/1` |  | native-feed |
| bilibili | UP 主非默认收藏夹 | `/bilibili/fav/756508/50948568` |  |  |
| bilibili | 热搜 | `/bilibili/hot-search` | www.bilibili.com/ |  |
| bilibili | UP 主点赞视频 | `/bilibili/user/like/208259` |  |  |
| bilibili | link 公告 | `/bilibili/link/news/live` |  |  |
| bilibili | 会员购作品 | `/bilibili/mall/ip/0_3000294` |  |  |
| bilibili | 会员购新品上架 | `/bilibili/mall/new/1` |  |  |
| bilibili | 漫画更新 | `/bilibili/manga/update/26009` |  |  |
| bilibili | 视频选集列表 | `/bilibili/video/page/BV1i7411M7N9` | www.bilibili.com |  |
| bilibili | 分区视频排行榜 | `/bilibili/partion/ranking/171/3` | www.bilibili.com |  |
| bilibili | 分区视频 | `/bilibili/partion/33` | www.bilibili.com |  |
| bilibili | 会员购票务 | `/bilibili/platform/-1` | show.bilibili.com/platform |  |
| bilibili | 综合热门 | `/bilibili/popular/all` | www.bilibili.com |  |
| bilibili | 专栏文集 | `/bilibili/readlist/25611` | www.bilibili.com |  |
| bilibili | 视频评论 | `/bilibili/video/reply/BV1vA411b7ip` | www.bilibili.com |  |
| bilibili | 用户追番列表 | `/bilibili/user/bangumi/208259` | www.bilibili.com |  |
| bilibili | UP 主频道的视频列表 | `/bilibili/user/channel/2267573/396050` | www.bilibili.com |  |
| bilibili | UP 主频道的合集 | `/bilibili/user/collection/245645656/529166` | www.bilibili.com |  |
| bilibili | UP 主默认收藏夹 | `/bilibili/user/fav/2267573` | www.bilibili.com |  |
| bilibili | UP 主投稿 | `/bilibili/user/video/2267573` | www.bilibili.com |  |
| bilibili | B 站每周必看 | `/bilibili/weekly` | www.bilibili.com |  |
| bsky | Feeds | `/bsky/profile/jaz.bsky.social/feed/cv:cat` |  |  |
| bsky | Keywords | `/bsky/keyword/hello` |  | native-feed |
| bsky | Post | `/bsky/profile/bsky.app` | bsky.app |  |
| changba | 用户 | `/changba/skp6hhF59n48R-UpqO3izw` | changba.com | podcast |
| crossbell/feeds | Feeds of following | `/crossbell/feeds/following/10` |  |  |
| crossbell/notes | Notes of character | `/crossbell/notes/character/10` | crossbell.io/* |  |
| crossbell/notes | Notes | `/crossbell/notes` | crossbell.io/* |  |
| crossbell/notes | Notes of source | `/crossbell/notes/source/xlog` | crossbell.io/* |  |
| curius | Username, can be found in URL | `/curius/links/yuu-yuu` |  |  |
| digg | Community Posts | `/digg/community/askdigg` | digg.com/ |  |
| douban/book | 新书速递 | `/douban/book/latest/fiction` |  |  |
| douban/book | 热门图书排行 | `/douban/book/rank/fiction` |  |  |
| douban/channel | 频道书影音 | `/douban/channel/30168934/subject/0` |  |  |
| douban/channel | 频道专题 | `/douban/channel/30168934/hot` |  |  |
| douban/commercialpress | 商务印书馆新书速递 | `/douban/commercialpress/latest` |  |  |
| douban/event | 热门同城活动 | `/douban/event/hot/118172` |  |  |
| douban/movie | 电影即将上映 | `/douban/movie/coming` |  |  |
| douban/other | 豆瓣书店 | `/douban/bookstore` |  |  |
| douban/other | 豆瓣电影人 | `/douban/celebrity/1274261` |  |  |
| douban/other | 豆瓣电影分类 | `/douban/movie/classification/R/7.5/Netflix,2020` |  |  |
| douban/other | 豆瓣读书论坛 | `/douban/36328704/discussion` |  |  |
| douban/other | 豆瓣豆列 | `/douban/doulist/37716774` |  |  |
| douban/other | 浏览发现 | `/douban/explore` |  |  |
| douban/other | 豆瓣小组 | `/douban/group/648102` |  |  |
| douban/other | 豆瓣招聘 | `/douban/jobs/campus` |  |  |
| douban/other | 即将上映的电影 | `/douban/movie/later` |  |  |
| douban/other | 最新增加的音乐 | `/douban/music/latest/chinese` |  |  |
| douban/other | 豆瓣榜单与集合 | `/douban/list/subject_real_time_hotest` |  |  |
| douban/other | 正在上映的电影 | `/douban/movie/playing` |  |  |
| douban/other | 豆瓣每月推荐片单 | `/douban/recommended/tv` |  |  |
| douban/other | 最新回应过的日记 | `/douban/replied/xiaoyaxiaoya` |  |  |
| douban/other | 日记最新回应 | `/douban/replies/xiaoyaxiaoya` |  |  |
| douban/other | 话题 | `/douban/topic/48823` |  |  |
| douban/other | 北美票房榜 | `/douban/movie/ustop` |  |  |
| douban/other | 一周口碑榜 | `/douban/movie/weekly` |  |  |
| douban/people | 用户想看 | `/douban/people/exherb/wish` |  |  |
| douban/tv | 即将播出的剧集 | `/douban/tv/coming` |  |  |
| fansly | User Timeline | `/fansly/user/AeriGoMoo` | fansly.com |  |
| fansly | Hashtag | `/fansly/tag/free` | fansly.com |  |
| farcaster | Farcaster User | `/farcaster/user/vitalik.eth` | www.farcaster.xyz |  |
| fediverse | Timeline | `/fediverse/timeline/Mastodon@mastodon.social` | fediverse.observer |  |
| furaffinity | Gallery | `/furaffinity/art/gallery/fender/nsfw` | furaffinity.net |  |
| furaffinity | Browse | `/furaffinity/browse/nsfw` | furaffinity.net |  |
| furaffinity | Commissions | `/furaffinity/commissions/fender` | furaffinity.net |  |
| furaffinity | Home | `/furaffinity/home/nsfw` | furaffinity.net |  |
| furaffinity | Journal Comments | `/furaffinity/journal-comments/10925112` | furaffinity.net |  |
| furaffinity | Journals | `/furaffinity/journals/fender` | furaffinity.net |  |
| furaffinity | Search | `/furaffinity/search/protogen/nsfw` | furaffinity.net |  |
| furaffinity | Shouts | `/furaffinity/shouts/fender` | furaffinity.net |  |
| furaffinity | Status | `/furaffinity/status` | furaffinity.net |  |
| furaffinity | Submission Comments | `/furaffinity/submission-comments/24259751` | furaffinity.net |  |
| furaffinity | Userpage | `/furaffinity/user/fender/nsfw` | furaffinity.net |  |
| furaffinity | User | `/furaffinity/watchers/fender` | furaffinity.net |  |
| furaffinity | User | `/furaffinity/watching/fender` | furaffinity.net |  |
| ganjingworld/channel | Articles in a channel | `/ganjingworld/channel/articles/1fcahpcut9t3gz4zIvYSJR7qd1cs0c` | www.ganjingworld.com |  |
| ganjingworld/channel | posts in a channel | `/ganjingworld/channel/posts/1fcahpcut9t3gz4zIvYSJR7qd1cs0c` | www.ganjingworld.com |  |
| ganjingworld/channel | Shorts in a channel | `/ganjingworld/channel/shorts/1fq5chh3ajo67UNu14uAvfzOp1a80c` | www.ganjingworld.com |  |
| ganjingworld/channel | Videos in a channel | `/ganjingworld/channel/videos/1eiqjdnq7go1OPYtIbLDVMpM61ok0c` | www.ganjingworld.com |  |
| gettr | User timeline | `/gettr/user/jasonmillerindc` | gettr.com |  |
| jianshu | 专题 | `/jianshu/collection/xYuZYD` |  |  |
| jianshu | 首页 | `/jianshu/home` | www.jianshu.com/ |  |
| jianshu | 作者 | `/jianshu/user/yZq3ZV` | www.jianshu.com |  |
| jike | 圈子 - 纯文字 | `/jike/topic/text/553870e8e4b0cafb0a1bef68` | m.okjike.com |  |
| jike | 圈子 | `/jike/topic/556688fae4b00c57d9dd46ee` | m.okjike.com |  |
| jike | 用户动态 | `/jike/user/3EE02BC9-C5B3-4209-8750-4ED1EE0F67BB` | m.okjike.com |  |
| keep | 运动日记 | `/keep/user/556b02c1ab59390afea671ea` | gotokeep.com |  |
| lens | Lens Profile | `/lens/profile/stani` | www.lens.xyz |  |
| likeshop | Posts | `/likeshop/nytimes` |  |  |
| linkedin | Jobs | `/linkedin/jobs/C-P/1/software engineer` |  |  |
| lofter | Collection | `/lofter/collection/552041` |  |  |
| lofter | Lofter user name, can be found in the URL | `/lofter/user/i` | www.lofter.com |  |
| mastodon | User timeline (by account ID) | `/mastodon/account_id/mas.to/109300507275095341/statuses/false` |  |  |
| mastodon | User timeline | `/mastodon/acct/Mastodon@mastodon.social/statuses` |  |  |
| mastodon | Instance timeline (local) | `/mastodon/timeline/pawoo.net/true` | mastodon.social |  |
| mastodon | Instance timeline (federated) | `/mastodon/remote/pawoo.net/true` | mastodon.social |  |
| misskey | Featured Notes | `/misskey/notes/featured/misskey.io` |  |  |
| misskey | User timeline | `/misskey/users/notes/support@misskey.io` | misskey.io |  |
| mit/scratch | Scratch User Comments | `/mit/scratch/user-comments/skota11` |  |  |
| mit/scratch | Scratch User Projects | `/mit/scratch/user-projects/abee` |  |  |
| pixiv | User Bookmark | `/pixiv/user/bookmarks/15288095` |  |  |
| pixiv | Rankings | `/pixiv/ranking/week` | www.pixiv.net |  |
| pixiv | Keyword | `/pixiv/search/Nezuko/popular` | www.pixiv.net |  |
| pixiv | User Activity | `/pixiv/user/15288095` | www.pixiv.net |  |
| plurk | Anonymous | `/plurk/anonymous` | plurk.com/anonymous |  |
| plurk | Hotlinks | `/plurk/hotlinks` | plurk.com/hotlinks |  |
| plurk | Plurk News | `/plurk/news/:lang?` | plurk.com/news |  |
| plurk | Search | `/plurk/search/FGO` | plurk.com |  |
| plurk | Top | `/plurk/top/topReplurks` | plurk.com |  |
| plurk | Topic | `/plurk/topic/standwithukraine` | plurk.com |  |
| plurk | User | `/plurk/user/plurkoffice` | plurk.com |  |
| qq/kg | 全民K歌 - 用户作品评论动态 | `/qq/kg/reply/OhXHMdO1VxLWQOOm` |  |  |
| qq/kg | 全民K歌 - 用户作品列表 | `/qq/kg/639a9a86272c308e33` |  | podcast |
| qq/news | 用户主页列表 | `/qq/news/8QMZ2X5a5YUeujw=` |  | podcast |
| rattibha | User Threads | `/rattibha/user/elonmusk` | rattibha.com |  |
| smartlink | Posts | `/smartlink/bloombergpursuits` |  |  |
| telegram | Telegram Blog | `/telegram/blog` | telegram.org/blog |  |
| telegram | Sticker Pack name, available in the sharing URL | `/telegram/stickerpack/DIYgod` | t.me |  |
| tiktok | Live | `/tiktok/live/@shinichifuku` |  |  |
| twitter | Trends | `/twitter/trends/23424856` | x.com |  |
| vimeo | Category | `/vimeo/category/documentary/staffpicks` |  |  |
| vimeo | Channel | `/vimeo/channel/bestoftheyear` |  |  |
| vimeo | User Profile | `/vimeo/user/filmsupply/picks` | vimeo.com |  |
| vocus | 出版專題 | `/vocus/publication/bass` | vocus.cc |  |
| vocus | 用户个人文章 | `/vocus/user/tsetyan` | vocus.cc |  |
| weibo/oasis | 绿洲用户 | `/weibo/oasis/user/1990895721` |  |  |
| zhihu/xhu | xhu - 用户动态 | `/zhihu/xhu/people/activities/246e6cf44e94cefbf4b959cb5042bc91` |  |  |
| zhihu/xhu | xhu - 用户回答 | `/zhihu/xhu/people/answers/246e6cf44e94cefbf4b959cb5042bc91` |  |  |
| zhihu/xhu | xhu - 收藏夹 | `/zhihu/xhu/collection/26444956` |  |  |
| zhihu/xhu | xhu - 用户文章 | `/zhihu/xhu/people/posts/246e6cf44e94cefbf4b959cb5042bc91` |  |  |
| zhihu/xhu | xhu - 问题 | `/zhihu/xhu/question/264051433` |  |  |
| zhihu/xhu | xhu - 话题 | `/zhihu/xhu/topic/19566035` |  |  |
| zhihu/xhu | xhu- 专栏 | `/zhihu/xhu/zhuanlan/githubdaily` |  |  |

### sport (2)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| skysports | News | `/skysports/news/ac-milan` | skysports.com |  |
| wfdf | News | `/wfdf/news` | wfdf.sport/news/ |  |

### study (30)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 163/open | 精品课程 | `/163/open/vip` | vip.open.163.com/ |  |
| aiea | Seminar Series | `/aiea/seminars/upcoming` |  |  |
| caai | 学会动态 | `/caai/45` |  |  |
| camchina | 栏目 | `/camchina` |  |  |
| catti | CATTI 考试消息 | `/catti/news/zxzc` | www.catticenter.com |  |
| ccf | 新闻 | `/ccf/news` | ccf.org.cn |  |
| ccf/ccfcv | 计算机视觉专委会 - 学术动态 - 分类 | `/ccf/ccfcv/xsdt/xsqy` |  |  |
| ccf/tfbd | 大数据专家委员会 | `/ccf/tfbd/xwdt/tzgg` |  |  |
| chinathinktanks | 观点与实践 | `/chinathinktanks/57` | www.chinathinktanks.org.cn |  |
| chsi | 考研热点新闻 | `/chsi/hotnews` | yz.chsi.com.cn/ |  |
| chsi | 考研动态 | `/chsi/kydt` | yz.chsi.com.cn/kyzx/kydt |  |
| chsi | 考研资讯 | `/chsi/kyzx/fstj` |  |  |
| cssn | Institute of Law | `/cssn/iolaw/zxzp` |  |  |
| cste | 栏目 | `/cste` |  |  |
| dblp | Keyword Search | `/dblp/knowledge%20tracing` | dblp.org |  |
| eshukan | 学术资讯 | `/eshukan/academic/1` | www.eshukan.com |  |
| fjksbm | 分类 | `/fjksbm` |  |  |
| hunanpea | 公告 | `/hunanpea/rsks/2f1a6239-b4dc-491b-92af-7d95e0f0543e` | rsks.hunanpea.com |  |
| kimlaw | Thesis | `/kimlaw/thesis` | kimlaw.or.kr/67 |  |
| mindmeister | Public Maps | `/mindmeister/mind-map-examples` |  |  |
| neea | 日本语能力测试 JLPT 通知 | `/neea/jlpt` | jlpt.neea.cn |  |
| orcid | Works List | `/orcid/0000-0002-4731-9700` |  |  |
| sdzk | 新闻 | `/sdzk` |  |  |
| shmeea | 消息 | `/shmeea/08000` |  |  |
| shmeea | 自学考试通知公告 | `/shmeea/self-study` | www.shmeea.edu.cn/page/04000/index.html |  |
| tableau | Viz of the day | `/tableau/viz-of-the-day` | public.tableau.com |  |
| visionias | News Today | `/visionias/newsToday` | visionias.in |  |
| visionias | Weekly Focus | `/visionias/weeklyFocus` | visionias.in |  |
| x-mol | News | `/x-mol/news/3` | x-mol.com/news/index |  |
| yuque | 用戶名 | `/yuque/ruanyf/weekly` |  |  |

### traditional-media (133)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| afr | Latest | `/afr/latest` | www.afr.com/latest |  |
| afr | Navigation | `/afr/navigation/markets` | www.afr.com |  |
| apnews | News (from mobile client API) | `/apnews/mobile` |  |  |
| apnews | News | `/apnews/rss/business` | apnews.com |  |
| apnews | Sitemap | `/apnews/sitemap/ap-sitemap-latest` | apnews.com |  |
| apnews | Topics | `/apnews/topics/apf-topnews` | apnews.com |  |
| banyuetan | 栏目 | `/banyuetan/jinritan` | www.banyuetan.org |  |
| bjx | 风电 | `/bjx/fd/yw` |  |  |
| bjx | 环保要闻 | `/bjx/huanbao` | huanbao.bjx.com.cn/yw |  |
| bjx | 光伏 | `/bjx/gf/sc` | www.bjx.com.cn |  |
| bnext | 最新文章 | `/bnext` | www.bnext.com.tw |  |
| caixin | 首页新闻 | `/caixin/article` | caixin.com/ | podcast |
| caixin | 新闻分类 | `/caixin/finance/regulation` |  | podcast |
| caixin | 财新数据通 | `/caixin/database` | k.caixin.com/web |  |
| caixin | 财新一线 | `/caixin/k` |  | podcast |
| caixin | 最新文章 | `/caixin/latest` | caixin.com/ |  |
| caixinglobal | Latest News | `/caixinglobal/latest` | caixinglobal.com/news |  |
| cankaoxiaoxi | 栏目 | `/cankaoxiaoxi/column/diyi` |  |  |
| cbc | News | `/cbc/topics` | cbc.ca/news |  |
| cctv | 专题 | `/cctv/world` |  |  |
| cctv | 央视网图片《镜象》 | `/cctv/photo/jx` | photo.cctv.com/jx |  |
| cctv | 栏目 | `/cctv/lm/xwzk` |  |  |
| cctv | 新闻联播 | `/cctv/tv/lm/xwlb` | tv.cctv.com/lm/xwlb |  |
| ce | 地方经济 | `/ce/district` | district.ce.cn |  |
| cgtn | 播客 | `/cgtn/podcast/ezfm/4` | cgtn.com |  |
| chinadaily | 英语点津 | `/chinadaily/language/thelatest` | language.chinadaily.com.cn | podcast |
| chinatimes | 分類 | `/chinatimes/realtimenews` | www.chinatimes.com/ |  |
| cna | 分类 | `/cna/aall` |  |  |
| cna/web | 分类 (网页爬虫方法) | `/cna/web/aall` |  |  |
| cnbc | Full article RSS | `/cnbc/rss` | search.cnbc.com | native-feed |
| cntheory | 学习时报 | `/cntheory/paper` | paper.cntheory.com |  |
| commonhealth | 最新內容 | `/commonhealth` | commonhealth.com.tw |  |
| cztv | 浙江新闻联播 - 每日合集 | `/cztv/zjxwlb/daily` | cztv.com/videos/zjxwlb |  |
| cztv | 浙江新闻联播 | `/cztv/zjxwlb` | cztv.com/videos/zjxwlb |  |
| dw | News | `/dw/news` | dw.com |  |
| dw | RSS | `/dw/rss/rss-en-all` | dw.com |  |
| eastday | 24 小时热闻 | `/eastday/24` | mini.eastday.com/ |  |
| eastday | 原创 | `/eastday/portrait` | www.eastday.com/ |  |
| eastday | 上海新闻 | `/eastday/sh` | sh.eastday.com/ |  |
| ebc | 即時新聞 | `/ebc/realtime/politics` | ebc.net.tw |  |
| economist | Espresso | `/economist/espresso` | economist.com/the-world-in-brief |  |
| economist | Category | `/economist/latest` |  | native-feed |
| economist | Global Business Review | `/economist/global-business-review/cn-en` | businessreview.global/ |  |
| ekantipur | Full Article RSS | `/ekantipur/news` |  |  |
| fjdaily | 电子报 | `/fjdaily/20260316` |  |  |
| foreignaffairs | RSS | `/foreignaffairs/rss` | www.foreignaffairs.com | native-feed |
| ft | myFT personal RSS | `/ft/myft/rss-key` |  |  |
| ftchinese | FT 中文网 | `/ftchinese/simplified/hotstoryby7day` |  |  |
| gq | News | `/gq/news` | gq.com |  |
| gzdaily | 客户端 | `/gzdaily/app/74` |  |  |
| hakkatv | 新聞首頁 | `/hakkatv/news` | hakkatv.org.tw/news |  |
| hebtv | 农博士在行动 | `/hebtv/nbszxd` | web.cmc.hebtv.com/cms/rmt0336/19/19js/st/ds/nmpd/nbszxd/index.shtml | podcast, BT |
| hket | 新闻 | `/hket/sran001` | www.hket.com/ |  |
| huanqiu | 分类 | `/huanqiu/news/china` | huanqiu.com/ |  |
| i-cable | 新聞 | `/i-cable/news` | www.i-cable.com/ |  |
| inewsweek | 栏目 | `/inewsweek/survey` |  |  |
| joins | 中央日报中文版 | `/joins/chinese` | chinese.joins.com |  |
| jornada | News | `/jornada/2022-10-12/capital` |  |  |
| koreaherald | News | `/koreaherald/National` |  |  |
| kyodonews | 最新报道 | `/kyodonews` |  |  |
| lemonde | News (English) | `/lemonde/en` |  |  |
| lemonde | News | `/lemonde` |  |  |
| mrdx | 今日 | `/mrdx/today` | mrdx.cn* |  |
| msn | Name of the channel. Find it in MSN url, e.g. Bloomberg | `/msn/zh-tw/Bloomberg/sr-vid-08gw7ky4u229xjsjvnf4n6n7v67gxm0pjmv9fr4y2x9jjmwcri4s` |  |  |
| newyorker | Articles | `/newyorker/latest` | newyorker.com |  |
| nhk | News Web Easy | `/nhk/news_web_easy` | news.web.nhk/news/easy/ |  |
| nhk | WORLD-JAPAN - Top Stories | `/nhk/news/en` | www3.nhk.or.jp |  |
| nmtv | 点播 | `/nmtv/column/877` |  |  |
| now | 新聞 | `/now/news` | news.now.com/ |  |
| npr | News | `/npr/1001` |  | native-feed |
| ntdtv | 频道 | `/ntdtv/b5/prog1201` |  |  |
| nytimes | Best Seller Books | `/nytimes/book/combined-print-and-e-book-nonfiction` | nytimes.com/ |  |
| nytimes | Daily Briefing | `/nytimes/daily_briefing_chinese` | nytimes.com/ |  |
| nytimes | News | `/nytimes/dual` | nytimes.com/ |  |
| nytimes | News | `/nytimes/rss/HomePage` | nytimes.com/ |  |
| oeeee | 奥一网 | `/oeeee/web/170` | oeeee.com |  |
| oeeee/app | 南都客户端（按南都号 ID） | `/oeeee/app/channel/50` |  |  |
| oeeee/app | 南都客户端（按记者） | `/oeeee/app/reporter/249` |  |  |
| oncc | 即時新聞 | `/oncc/zh-hant/news` |  |  |
| oncc | Money18 | `/oncc/money18/exp` |  |  |
| people | 领导留言板 | `/people/liuyan/539` | liuyan.people.com.cn/ |  |
| people | 习近平系列重要讲话 | `/people/xjpjh` | people.com.cn/ |  |
| pts | 分類 | `/pts/category/9` |  |  |
| pts | 專題策展 | `/pts/curations` | news.pts.org.tw/curations |  |
| pts | 即時新聞 | `/pts/dailynews` | news.pts.org.tw/dailynews |  |
| pts | 整理報導 | `/pts/live/62e8e4bbb4de2cbd74468b2b` |  |  |
| pts | 觀點 | `/pts/opinion` | news.pts.org.tw/opinion |  |
| pts | 數位敘事 | `/pts/projects` | news.pts.org.tw/projects |  |
| pts | 深度報導 | `/pts/report` | news.pts.org.tw/report |  |
| pts | 標籤 | `/pts/tag/230` | news.pts.org.tw |  |
| reuters | Category/Topic/Author | `/reuters/world/us` |  |  |
| reuters | Inverstigates | `/reuters/investigates` |  |  |
| rfa | News | `/rfa/english` |  |  |
| rodong | News | `/rodong/news` | rodong.rep.kp/cn/index.php |  |
| scmp | News | `/scmp/3` |  |  |
| scmp | Topics | `/scmp/topics/coronavirus-pandemic-all-stories` | scmp.com |  |
| sctv | 电视回放 | `/sctv/programme/1` | sctv.com |  |
| setn | 新聞 | `/setn` | setn.com/ViewAll.aspx |  |
| solidot | 最新消息 | `/solidot/linux` |  | native-feed |
| southcn/nfapp | 南方 +（按栏目 ID） | `/southcn/nfapp/column/38` |  |  |
| southcn/nfapp | 南方 +（按作者） | `/southcn/nfapp/reporter/969927791` |  |  |
| sputniknews | Category | `/sputniknews` |  |  |
| straitstimes | News | `/straitstimes/singapore` |  |  |
| taiwannews | Hot News | `/taiwannews/hot` |  |  |
| tass | News | `/tass/politics` | tass.com |  |
| theatlantic | News | `/theatlantic/latest` | www.theatlantic.com |  |
| thehindu | Topic | `/thehindu/topic/rains` | thehindu.com |  |
| tkww | 新聞 | `/tkww/hong_kong` |  |  |
| tvb | 新闻 | `/tvb/news` | tvb.com |  |
| udn | 即時新聞 | `/udn/news/breakingnews/99` |  |  |
| udn/global | 轉角國際 - 首頁 | `/udn/global` |  |  |
| udn/global | 轉角國際 - 標籤 | `/udn/global/tag/過去24小時` |  |  |
| vom | News | `/vom/featured` |  |  |
| washingtonpost | App | `/washingtonpost/app/national` |  |  |
| wsj | News | `/wsj/en-us/opinion` | cn.wsj.com |  |
| xkb | 新闻 | `/xkb/350` |  |  |
| xmnn | 数字媒体 | `/xmnn/epaper/xmrb` |  |  |
| xmnn | 新闻 | `/xmnn/news/xmxw` | epaper.xmnn.cn |  |
| ycwb | 新闻 | `/ycwb/1` |  |  |
| yicai | 一财号 | `/yicai/author/100005663` |  |  |
| yicai | 正在 | `/yicai/brief` | yicai.com/brief |  |
| yicai | 轮播 | `/yicai/carousel` | yicai.com/ |  |
| yicai | DT 财经 | `/yicai/dt/article` |  |  |
| yicai | 关注 | `/yicai/feed/669` |  |  |
| yicai | 头条 | `/yicai/headline` | yicai.com/ |  |
| yicai | 最新 | `/yicai/latest` | yicai.com/ |  |
| yicai | 新闻 | `/yicai/news` | yicai.com |  |
| yicai | 视听 | `/yicai/video` | yicai.com |  |
| yicai | VIP 频道 | `/yicai/vip/428` | yicai.com |  |
| yna | News | `/yna/en/national` |  | native-feed |
| yomiuri | News | `/yomiuri/news` | www.yomiuri.co.jp |  |
| zaobao | 新闻 | `/zaobao/znews/china` | www.zaobao.com |  |
| zjol | 浙报集团系列报刊 | `/zjol/paper/zjrb` | zjol.com.cn |  |

### travel (16)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| 12306 | 售票信息 | `/12306/2022-02-19/重庆/永川东` |  |  |
| 12306 | 最新动态 | `/12306/zxdt` | www.12306.cn/ |  |
| airchina | 服务公告 | `/airchina/announcement` | www.airchina.com.cn/ |  |
| brooklynmuseum | Exhibitions | `/brooklynmuseum/exhibitions` |  |  |
| chnmuseum | 资讯要闻 | `/chnmuseum/zx/xingnew` | www.chnmuseum.cn |  |
| chnmuseum | 资讯专题 | `/chnmuseum/zx/xwzt` | www.chnmuseum.cn |  |
| flyert | 信用卡 | `/flyert/creditcard/zhongxin` | flyert.com/ |  |
| flyert | 优惠信息 | `/flyert/preferential` | flyert.com/ |  |
| fzmtr | 通知公告 | `/fzmtr/announcements` |  |  |
| guangzhoumetro | 新闻 | `/guangzhoumetro/news` | www.gzmtr.com |  |
| jewishmuseum | Exhibitions | `/jewishmuseum/exhibitions` |  |  |
| natgeo | 分类 | `/natgeo/environment/article` | nationalgeographic.com |  |
| nationalgeographic | Latest Stories | `/nationalgeographic/latest-stories` | www.nationalgeographic.com/pages/topic/latest-stories |  |
| newmuseum | Exhibitions | `/newmuseum/exhibitions` |  |  |
| nippon | 政治外交 | `/nippon/Politics` |  |  |
| yamap | 文章 | `/yamap` |  |  |

### uncategorized (5)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| capitalmind | Insights | `/capitalmind/insights` |  |  |
| jandan | Feed | `/jandan` |  |  |
| jandan | Section | `/jandan/top` | jandan.net |  |
| visionias | Daily News Summary | `/visionias/dailySummary` |  |  |
| visionias | Monthly Magazine | `/visionias/monthlyMagazine` |  |  |

### university (312)

| namespace | route | example | 域名 | 媒体 |
| --- | --- | --- | --- | --- |
| ahjzu | 通知公告 | `/ahjzu/news` | news.ahjzu.edu.cn/20/list.htm |  |
| bit | 人才招聘 | `/bit/rszhaopin` | rszhaopin.bit.edu.cn/ |  |
| bit | 研究生院招生信息 | `/bit/yjs` | grd.bit.edu.cn/zsgz/zsxx/index.htm |  |
| bit/cs | 计院通知 | `/bit/cs` | cs.bit.edu.cn/tzgg |  |
| bit/jwc | 教务处通知 | `/bit/jwc` | jwc.bit.edu.cn/tzgg |  |
| bjfu | 研究生院培养动态 | `/bjfu/grs` | graduate.bjfu.edu.cn/ |  |
| bjfu | 科技处通知公告 | `/bjfu/kjc` | kyc.bjfu.edu.cn/ |  |
| bjfu/it | 信息学院通知 | `/bjfu/it/xyxw` |  |  |
| bjfu/jwc | 教务处通知公告 | `/bjfu/jwc/jwkx` |  |  |
| bjfu/news | 绿色新闻网 | `/bjfu/news/lsyw` |  |  |
| bnu | 经济与工商管理学院 | `/bnu/bs` |  |  |
| bnu | 党委学生工作部 | `/bnu/dwxgb/xwzx/tzgg` |  |  |
| bnu | 经济与工商管理学院MBA | `/bnu/mba/xwdt` | mba.bnu.edu.cn |  |
| buaa | 教务部 | `/buaa/jiaowu/02` | jiaowu.buaa.edu.cn |  |
| buaa | 集成电路科学与工程学院 | `/buaa/sme/tzgg` | www.sme.buaa.edu.cn |  |
| buaa/lib/space | 图书馆 - 新书速递 | `/buaa/lib/space/newbook/` | space.lib.buaa.edu.cn/mspace/newBook |  |
| buaa/news | 新闻网 | `/buaa/news/zhxw` |  |  |
| buct | 信息学院 | `/buct/cist` | buct.edu.cn/ |  |
| buct | 研究生院 | `/buct/gr/jzml` | buct.edu.cn/ |  |
| buct | 教务处 | `/buct/jwc` | buct.edu.cn/ |  |
| bupt | 教务处 | `/bupt/jwc/tzgg` | jwc.bupt.edu.cn |  |
| bupt | 人才招聘 | `/bupt/rczp` | bupt.edu.cn/ |  |
| bupt | 网络空间安全学院 - 通知公告 | `/bupt/scss/tzgg` | scss.bupt.edu.cn |  |
| cags/edu | 研究生院 | `/cags/edu/tzgg` |  |  |
| cas/cg | 成果转化 | `/cas/cg/cgzhld` |  |  |
| cas/ia | 自动化所 | `/cas/ia/yjs` | www.ia.cas.cn/yjsjy/zs/sszs |  |
| cas/mesalab | 信息工程研究所 第二研究室 处理架构组 知识库 | `/cas/mesalab/kb` | www.mesalab.cn/f/article/articleList |  |
| cas/sim | 上海微系统与信息技术研究所 科技进展 | `/cas/sim/kyjz` | www.sim.cas.cn/xwzx2016/kyjz |  |
| cau | 研招网通知公告 | `/cau/ele` | ciee.cau.edu.cn/col/col26712/index.html |  |
| cau | 研招网通知公告 | `/cau/yjs` | yz.cau.edu.cn/col/col41740/index.html |  |
| ccnu | 就业信息 | `/ccnu/career` | ccnu.91wllm.com/news/index/tag/tzgg |  |
| ccnu | 伍论贡学院 | `/ccnu/wu` | uowji.ccnu.edu.cn/xwzx/tzgg.htm |  |
| ccnu | 研究生通知公告 | `/ccnu/yjs` | gs.ccnu.edu.cn/zsgz/ssyjs.htm |  |
| cdu | 成大人物 | `/cdu/cdrw` | news.cdu.edu.cn/ |  |
| cdu | 教务处通知公告 | `/cdu/jwgg` | jw.cdu.edu.cn/ |  |
| cdu | 通知公告 | `/cdu/tzggcdunews` | news.cdu.edu.cn/ |  |
| cnu | 信息工程学院通知公告 | `/cnu/iec` | iec.cnu.edu.cn/ggml/tzgg1/index.htm |  |
| cnu | 焦点关注 | `/cnu/jdxw` | news.cnu.edu.cn/xysx/jdxw/index.htm |  |
| cnu | 教务处通知公示 | `/cnu/jwc` | jwc.cnu.edu.cn/tzgg/index.htm |  |
| cnu | 物理系院系新闻 | `/cnu/physics` | physics.cnu.edu.cn/news/index.htm |  |
| cnu | 生命科学学院通知公告 | `/cnu/smkxxy` | smkxxy.cnu.edu.cn/tzgg3/index.htm |  |
| cqwu | 通知公告 | `/cqwu/news/academiceve` |  |  |
| csu | 就业信息网招聘信息 | `/csu/career` | career.csu.edu.cn/campus/index/category/1 |  |
| csu | 校长信箱 | `/csu/mail` |  |  |
| ctbu | 学校公告 | `/ctbu/xxgg` | www.ctbu.edu.cn/ |  |
| cuc | 研究生招生网 | `/cuc/yz` | yz.cuc.edu.cn/8549/list.htm |  |
| cugb | 教务处 | `/cugb/jwc/xszq` |  |  |
| cugb | 校园新闻 | `/cugb/news/bdxw` | cugb.edu.cn |  |
| cupl | 教务处通知公告 | `/cupl/jwc` | jwc.cupl.edu.cn/index/tzgg.htm |  |
| dgut | 教务部通知公告 | `/dgut/jwb/jwtz` |  |  |
| dhu/jiaowu | 教务处通知 | `/dhu/jiaowu/news/student` |  |  |
| dhu/news | 学术信息 | `/dhu/news/xsxx` | news.dhu.edu.cn/6410 |  |
| dhu/xxgk | 最新信息公开 | `/dhu/xxgk/news` |  |  |
| dhu/yjs | 研究生院通知 | `/dhu/yjs/news/class` |  |  |
| ecnu | ACM Online-Judge contests list | `/ecnu/acm/contest/public` | acm.ecnu.edu.cn/contest/ |  |
| ecnu | 研究生院 | `/ecnu/yjs` | yz.kaoyan.com/ecnu/tiaoji |  |
| ecust/e | 继续教育学院 - 学院公告 | `/ecust/jxjy/news` | e.ecust.edu.cn/engine2/m/38F638B77773ADD3 |  |
| ecust/gschool | 研究生院通知公告 | `/ecust/yjs` | gschool.ecust.edu.cn/12753/list.htm |  |
| ecust/jwc | 本科教务处信息网 | `/ecust/jwc/mto` |  |  |
| gdufs | 新闻 | `/gdufs/news` | www.gdufs.edu.cn/gwxw/gwxw1.htm |  |
| gdufs/xwxy | 新闻学院-新闻中心 | `/gdufs/xwxy/news` | xwxy.gdufs.edu.cn |  |
| gmu | 新闻中心 | `/gmu/news/gyyw` | gmu.cn/xwzx/gyyw.htm |  |
| gmu | 研究生院 | `/gmu/yjs/zsgz/tzgg` | gmu.cn |  |
| gxmzu | 人工智能学院通知公告 | `/gxmzu/aitzgg` | ai.gxmzu.edu.cn/index/tzgg.htm |  |
| gxmzu | 图书馆最新消息 | `/gxmzu/libzxxx` | library.gxmzu.edu.cn/news/news_list.jsp |  |
| gxmzu | 研究生院招生公告 | `/gxmzu/yjszsgg` | yjs.gxmzu.edu.cn/tzgg/zsgg.htm |  |
| gzhu | 研究生院招生动态 | `/gzhu/yjs` | yjsy.gzhu.edu.cn/zsxx/zsdt/zsdt.htm |  |
| hdu/auto | 自动化学院 | `/hdu/auto` |  |  |
| hdu/cs | 计算机学院 - 通知公告 | `/hdu/cs` | computer.hdu.edu.cn/6738/list.htm |  |
| hdu/cs | 计算机学院 - 研究生通知 | `/hdu/cs/pg` | computer.hdu.edu.cn/6769/list.htm |  |
| hfut/hf | 合肥校区通知 | `/hfut/hf/notice/tzgg` |  |  |
| hfut/xc | 宣城校区通知 | `/hfut/xc/notice/tzgg` |  |  |
| hit | 研究生院 | `/hit/hitgs/tzgg` | hitgs.hit.edu.cn |  |
| hit | 今日哈工大 | `/hit/today/10` | www.hit.edu.cn |  |
| hitsz | 新闻中心 | `/hitsz/article/id-74` |  |  |
| hitsz | 教务部 | `/hitsz/due/tzgg` | due.hitsz.edu.cn |  |
| hitsz | 教务部教务学务与学位管理所有栏目 | `/hitsz/due/general` | due.hitsz.edu.cn |  |
| hlju | 新闻网 | `/hlju/news/hdyw` | hlju.edu.cn |  |
| hljucm | 研究生院 | `/hljucm/yjsy` | yjsy.hljucm.net |  |
| hnu | 校园招聘 | `/hnu/careers` | scc.hnu.edu.cnundefined |  |
| hrbeu/cec | 航天与建筑工程学院 | `/hrbeu/cec/tzgg` |  |  |
| hrbeu/job | 大型招聘会 | `/hrbeu/job/bigemploy` | job.hrbeu.edu.cn/* |  |
| hrbeu/job | 就业服务平台 | `/hrbeu/job/calendar` | job.hrbeu.edu.cn/* |  |
| hrbeu/job | 就业服务平台 | `/hrbeu/job/list/tzgg` |  |  |
| hrbeu/sec | 船舶工程学院 | `/hrbeu/sec/xshd` |  |  |
| hrbeu/ugs | 本科生院工作通知 | `/hrbeu/ugs/news/jwc/jxap` |  |  |
| hrbeu/yjsy | 研究生院 | `/hrbeu/yjsy/list/2981` |  |  |
| hrbust | 计算机学院 | `/hrbust/cs` | cs.hrbust.edu.cn |  |
| hrbust | 国有资产管理处 | `/hrbust/gzc` | gzc.hrbust.edu.cn |  |
| hrbust | 教务处 | `/hrbust/jwzx` | jwzx.hrbust.edu.cn |  |
| hrbust | 图书馆 | `/hrbust/lib` | lib.hrbust.edu.cn |  |
| hrbust | 新闻网 | `/hrbust/news` | news.hrbust.edu.cn |  |
| hrbust | 网络信息中心 | `/hrbust/nic` | nic.hrbust.edu.cn |  |
| hubu | 主页 | `/hubu/www/index/tzgg` | hubu.edu.cn |  |
| hubu | 资源环境学院 | `/hubu/zhxy/index/tzgg` | zhxy.hubu.edu.cn |  |
| hunau | 国际交流与合作处、国际教育学院、港澳台事务办公室 | `/hunau/ied` | xky.hunau.edu.cn/ |  |
| hunau | 教务处 | `/hunau/jwc` | xky.hunau.edu.cn/ |  |
| hunau/gfxy | 公共管理与法学学院 | `/hunau/gfxy` | xky.hunau.edu.cn/ |  |
| hunau/xky | 信息与智能科学学院 | `/hunau/xky` | xky.hunau.edu.cn/ |  |
| hust | 研究生院 | `/hust/gs/xwdt` | gs.hust.edu.cn |  |
| hust | 机械科学与工程学院 | `/hust/mse/sylm/xyxw` | mse.hust.edu.cn |  |
| isct | News | `/isct/news/ja` | isct.ac.jp |  |
| jlu/phy | 物理学院 | `/jlu/phy/xzgz/tzgg` | phy.jlu.edu.cn |  |
| jou | 官网通知公告 | `/jou/tzgg` | www.jou.edu.cn/index/tzgg.htm |  |
| jou | 研招网通知公告 | `/jou/yztzgg` | yz.jou.edu.cn/index/zxgg.htm |  |
| jsu | 创新中心 | `/jsu/cxzx/xkjs` |  |  |
| jsu | 教务处 | `/jsu/jwc/jwdt` |  |  |
| jsu | 数学与统计学院 - 通知公告 | `/jsu/stxy` |  |  |
| jsu | 计算机科学与工程学院 - 通知公告 | `/jsu/rjxy` | jsu.edu.cn |  |
| jsu | 通知公告 | `/jsu/notice` | jsu.edu.cn |  |
| lsnu/jiaowc | 教学部通知公告 | `/lsnu/jiaowc/tzgg` | lsnu.edu.cn/ |  |
| nankai | 人工智能学院 | `/nankai/ai/zxdt` | ai.nankai.edu.cn |  |
| nankai | 研究生院 | `/nankai/graduate/zxdt` | graduate.nankai.edu.cn |  |
| nankai | 教务处通知公告 | `/nankai/jwc` | jwc.nankai.edu.cn |  |
| nankai | 研究生招生网 | `/nankai/yzb/5509` | yzb.nankai.edu.cn |  |
| ncepu/master | 北京校区研究生院 | `/ncepu/master/tzgg` |  |  |
| ncku | 國立成功大學資訊系公告 | `/ncku/csie/normal` |  |  |
| ncku | 國立成功大學物理系公告 | `/ncku/phys/_all` | www.ncku.edu.tw |  |
| ncu | 教务通知 | `/ncu/jwc` | jwc.ncu.edu.cn/Notices.jsp |  |
| ncwu | 学校通知 | `/ncwu/notice` | ncwu.edu.cn/xxtz.htm |  |
| neu | 医学与生物信息工程学院 | `/neu/bmie/news` |  |  |
| neu | 新闻网 | `/neu/news/ddyw` | neunews.neu.edu.cn |  |
| neu | 研究生招生信息网 | `/neu/yz/master1` | yz.neu.edu.cn |  |
| njit | 教务处 | `/njit/jwc/jx` |  |  |
| njit | 通知公告 | `/njit/tzgg` | www.njit.edu.cn/ |  |
| njnu/ceai | 计算机与电子信息学院 - 人工智能学院 | `/njnu/ceai/xszx` |  |  |
| njnu/jwc | 教务通知 | `/njnu/jwc/xstz` |  |  |
| nju | 本科迎新 | `/nju/admission` | admission.nju.edu.cn/tzgg/index.html |  |
| nju | 大学外语部 | `/nju/dafls` | dafls.nju.edu.cn/13167/list.html |  |
| nju | 本科生交换生系统 | `/nju/exchangesys/proj` |  |  |
| nju | 研究生院 | `/nju/gra` | grawww.nju.edu.cn/main.htm |  |
| nju | 校医院 | `/nju/hospital` | hospital.nju.edu.cn/ggtz/index.html |  |
| nju | 后勤集团 | `/nju/hqjt` | webplus.nju.edu.cn/_s25/main.psp |  |
| nju | ITSC 信息中心 | `/nju/itsc` | itsc.nju.edu.cn/tzgg/list.htm |  |
| nju | 基建处 | `/nju/jjc` | jjc.nju.edu.cn/main.htm |  |
| nju | 本科生院 | `/nju/jw/ggtz` |  |  |
| nju | 人才招聘网 | `/nju/rczp/xxfb` | admission.nju.edu.cn |  |
| nju | 科学技术处 | `/nju/scit/tzgg` | admission.nju.edu.cn |  |
| nju | 招标办公室 | `/nju/zbb/cgxx` | admission.nju.edu.cn |  |
| nju | 资产管理处 | `/nju/zcc` | zcc.nju.edu.cn/tzgg/gyfytdglk/index.html |  |
| njupt | 教务处通知与新闻 | `/njupt/jwc/notice` |  |  |
| njxzc | 官网通知公告 | `/njxzc/tzgg` | www.njxzc.edu.cn/89/list.htm |  |
| njxzc | 图书馆通知公告 | `/njxzc/libtzgg` | lib.njxzc.edu.cn/pxyhd/list.htm |  |
| nudt | 研究生院 | `/nudt/yjszs/2` | yjszs.nudt.edu.cn/ |  |
| nuist | NUIST CS（南信大计软院） | `/nuist/scs/xwkx` | bulletin.nuist.edu.cn |  |
| nuist | 南信大学生工作处 | `/nuist/xgc` | xgc.nuist.edu.cn/ |  |
| nwafu | 校园要闻 | `/nwafu/lib` |  |  |
| nwnu/routes/college | 计算机科学与工程学院 | `/nwnu/college/csse/2435` |  |  |
| nwnu/routes/department | 教务处 | `/nwnu/department/academic-affairs/tzgg` |  |  |
| nwnu/routes/department | 研究生院 | `/nwnu/department/postgraduate/2701` |  |  |
| ouc | 信息科学与工程学院研究生招生通知公告 | `/ouc/it/postgraduate` | it.ouc.edu.cn/_s381/16619/list.psp |  |
| ouc | 选课信息教务通知 | `/ouc/jwgl` | jwgl.ouc.edu.cn/cas/login.action |  |
| pku | 人事处 | `/pku/hr` | hr.pku.edu.cn/ |  |
| pku | 观点 - 国家发展研究院 | `/pku/nsd/gd` | nsd.pku.edu.cn/ |  |
| pku | 研究生招生网 | `/pku/admission/sszs` | admission.pku.edu.cn/zsxx/sszs/index.htm |  |
| pku/cls | 生命科学学院通知公告 | `/pku/cls/announcement` | bio.pku.edu.cn/homes/Index/news/21/21.html |  |
| pku/cls | 生命科学学院近期讲座 | `/pku/cls/lecture` | bio.pku.edu.cn/homes/Index/news_jz/7/7.html |  |
| pku/rccp | 每周一推 - 中国政治学研究中心 | `/pku/rccp/mzyt` | www.rccp.pku.edu.cn/ |  |
| pku/scc | 学生就业指导服务中心 | `/pku/scc/recruit/zpxx` |  |  |
| pku/ss | 软件与微电子学院 - 硕士统考招生通知 | `/pku/ss/pgadmin` | ss.pku.edu.cn/admission/admbrochure/admission01 |  |
| pumc | “4+4” 试点班招生网通知公告 | `/pumc/mdadmission` | mdadmission.pumc.edu.cn/mdweb/site |  |
| qdu | 后勤管理处通知 | `/qdu/houqin` | houqin.qdu.edu.cn/tzgg.htm |  |
| qlu | 通知公告 | `/qlu/notice` | qlu.edu.cn/tzggsh/list1.htm |  |
| qust | 教务通知 | `/qust/jw` | jw.qust.edu.cn/jwtz.htm |  |
| qztc/home | 首页 | `/qztc/home/2093` | www.qztc.edu.cn |  |
| qztc/jwc | 教务处 | `/qztc/jwc/jwdt` | www.qztc.edu.cn |  |
| qztc/sjxy | 数学与计算机科学学院 软件学院 | `/qztc/sjxy/1939` | www.qztc.edu.cn |  |
| ruc | 高瓴人工智能学院 | `/ruc/ai` | ai.ruc.edu.cn/ |  |
| ruc | 人事处 | `/ruc/hr` | hr.ruc.edu.cn/ |  |
| sass/gs | 研究生院 | `/sass/gs/1793` |  |  |
| scau | 华农研讯 | `/scau/yzb` | yzb.scau.edu.cn/2136/list1.htm |  |
| scau | 研究生院通知 | `/scau/yjsy` | yjsy.scau.edu.cn/208/list.htm |  |
| scnu | 教务处通知 | `/scnu/jw` | jw.scnu.edu.cn/ann/index.html |  |
| scnu | 图书馆通知 | `/scnu/library` | lib.scnu.edu.cn/news/zuixingonggao |  |
| scnu | 软件学院通知公告 | `/scnu/ss` | ss.scnu.edu.cn/tongzhigonggao |  |
| scnu | 研究生院通知公告 | `/scnu/yjs` | yz.scnu.edu.cn/tongzhigonggao/ssgg |  |
| scu/jwc | 教务处通知公告 | `/scu/jwc` |  |  |
| scu/scupi | 匹兹堡学院通知 | `/scu/scupi` | scupi.scu.edu.cn/activities/notice |  |
| scut/jwc | 教务处通知公告 | `/scut/jwc/notice/all` |  |  |
| scut/jwc | 教务处学院通知 | `/scut/jwc/school/all` |  |  |
| scut/scet | 土木与交通学院 - 学工通知 | `/scut/scet/notice` |  |  |
| scvtc | 学院公告 | `/scvtc/xygg` | scvtc.edu.cn/ggfw1/xygg.htm |  |
| sdu | 材料科学与工程学院通知 | `/sdu/cmse/0` |  |  |
| sdu | 能源与动力工程学院通知 | `/sdu/epe/0` |  |  |
| sdu | 国际事务部 | `/sdu/gjsw/tzgg` |  |  |
| sdu | 机械工程学院通知 | `/sdu/mech/0` |  |  |
| sdu | 软件学院通知 | `/sdu/sc/0` | www.sdu.edu.cn |  |
| sdu | 研工部 | `/sdu/ygb/zytz` | www.sdu.edu.cn |  |
| sdu | 研究生招生信息网 | `/sdu/yz/tzgg` | www.sdu.edu.cn |  |
| sdu/cs | 计算机科学与技术学院通知 | `/sdu/cs/index/announcement` |  |  |
| sdu/cs | 计算机科学与技术学院研究生工作网站 | `/sdu/cs/yjsgz/zytz` |  |  |
| sdu/qd | 学生在线（青岛） | `/sdu/qd/xszxqd/xtyw` |  |  |
| sdu/qd | 青岛校区学科建设与研究生教育办公室 | `/sdu/qd/xyb/gztz` |  |  |
| sdu/wh | 教务处 | `/sdu/wh/jwc/gztz` |  |  |
| sdu/wh | 新闻网 | `/sdu/wh/news/xyyw` |  |  |
| sdust/yjsy | 研究生招生网 | `/sdust/yjsy/zhaosheng` |  |  |
| seu/cyber | 网络空间安全学院 - 通知公告 | `/seu/cyber/tzgg` |  |  |
| shisu | 上外新闻 | `/shisu/news/news` | shisu.edu.cn |  |
| shmtu | 教务信息 | `/shmtu/jwc/jwgg` |  |  |
| shmtu | 数字平台 | `/shmtu/portal/bmtzgg` | jwc.shmtu.edu.cn |  |
| … | _+112 more_ | | | |

