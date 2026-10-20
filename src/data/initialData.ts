import { User, Device, Branch, Requisition, StageInfo, LifecycleStage } from '../types';

export const RAW_BRANCHES: { id: string; name: string; st: [string, string, string, string, string][] }[] = [
  {"id": "100", "name": "Head Office", "st": [["5546", "CHHOEUN Seyha", "Head In-Store Merchant Support Unit", "Operating", "070 630 803"], ["6426", "SAN Channareth", "MS Supervisor", "Operating", "015 630 817"], ["8986", "SAY Chanmakara", "Deputy Head of In Store Merchant Support Unit", "Operating", "093 630 876"], ["12004", "KHUN Virakboth", "MS Supervisor", "Operating", "016 630 186"], ["8645", "LENG Rothana", "Senior MS Officer", "Operating", "081 630 256"], ["10454", "MANN Vanna", "MS Supervisor", "Operating", "010 752 570"], ["8525", "OEUNG Yongchhy", "Senior MS Officer", "Operating", "081 630 945"], ["12450", "MAM Manit", "Senior MS Officer", "Operating", "010 850 378"], ["10764", "NGET Monioudom", "MS Team Lead", "Operating", "093630256 / 061559938"], ["13390", "PHORN Phynith", "Leasing and Develpoment Supervisor", "Operating", "010 234 967"], ["14460", "YIN Chamroeun", "Senior MS Officer", "Operating", "096 335 3655 / 95 349 355"], ["13253", "CHHAY Sideth", "MS Team Lead", "Operating", "089 963 883"], ["13248", "CHHEUY Sophanna", "Senior MS Officer", "Operating", "016 474 979 / 095 222 188"], ["13677", "SAM Darak", "MS Team Lead", "Operating", "096 378 2733/069 630 900"], ["15872", "KIMLEAN Khinsethdaka", "Senior Leasing and Develpoment Officer", "Operating", "093 630 331"], ["17016", "BLONH Sarom", "MS Officer", "Operating", "88 907 6726"], ["14461", "PECH Sreypich", "MS Team Lead", "Operating", "016 590 955"], ["14614", "TOUCH Leangheng", "MS Team Lead", "Operating", "96 828 2594"], ["17728", "MAM Vorleak", "MS Officer", "Operating", ""], ["17729", "KHEOURN Sreyda", "MS Officer", "Operating", ""], ["14944", "VANN Mony", "MS Officer", "Operating", "078 625 163"], ["16062", "NGET Saven", "MS Officer", "Operating", "016 647 529/ 66 688 058"], ["16153", "LORM Lim", "MS Officer", "Operating", "096 55 51 341"], ["17209", "Chan Borin", "MS Officer", "Operating", "012 986 633"], ["17411", "CHHUM Sovannarum", "MS Officer", "Operating", "(+855) 11 523 794"], ["18353", "HOUR Seanghy", "MS Officer", "Operating", ""], ["19959", "HENG Lita", "MS Officer", "Operating", ""], ["19073", "MOM Chanrachana", "MS Officer", "Operating", ""], ["21938", "YEUN Sonita", "MS Officer", "Operating", "97 863 6209"], ["24069", "CHHENG Kongheang", "MS Officer", "Operating", ""], ["24112", "SOK Pichchamreoun", "MS Officer", "Operating", ""], ["24958", "RIN Sophanara", "MS Officer", "Operating", ""], ["25707", "CHHOEUN Narat", "MS Officer", "Operating", "(+855) 99 328 252"], ["25704", "KE Sithat", "MS Officer", "Operating", "(+855) 87 651 284"], ["25706", "MOK ChanvouchEng", "MS Officer", "Operating", "(+855) 96 863 9546"], ["25708", "SAM Bodalin", "MS Officer", "Operating", "(+855) 96 662 4808"], ["26024", "DOL Kimheng", "MS Officer", "Operating", ""], ["26000", "YORNG Dara", "MS Officer", "Operating", "097 569 2902"], ["26355", "SEREY Sonita", "MS Officer", "Operating", ""], ["26501", "KEO Sokkheng", "MS Officer", "Operating", ""], ["26688", "CHHEN Punleu", "MS Officer", "Operating", ""], ["26561", "KONG Lyka", "MS Officer", "Operating", ""], ["26780", "HEANG Hunorn", "MS Officer", "Operating", ""], ["27082", "NEANG Chungheang", "MS Officer", "Operating", ""], ["27083", "SOMART Monyratanak", "MS Officer", "Operating", ""], ["27290", "KHA Srey Net", "MS Officer", "Operating", "098 572 824"]]},
  {"id": "101", "name": "Borei Keyla Branch", "st": [["25490", "SEOUN Chettra", "MS Officer", "Operating", "(+855) 89 591 091"], ["27267", "KY Vibol", "MS Officer", "Operating", "096 294 9973"], ["27750", "LIM SOKHONG", "MS Officer", "Pending", ""]]},
  {"id": "102", "name": "Mao Tse Toung Branch", "st": [["17022", "HON Bunheng", "MS Officer", "Operating", "86 811 108"], ["27525", "THOEUN Raksa", "MS Officer", "Operating", "088 927 2650"], ["27631", "CHHON Sohoung", "MS Officer", "Operating", ""]]},
  {"id": "103", "name": "Stade Chas Branch", "st": [["16443", "TEP Phanith", "MS Officer", "Operating", "071 693 6879"], ["27388", "Horn Prompiseth", "MS Officer", "Operating", "016 227 927"], ["27423", "AN Sreymom", "MS Officer", "Operating", "098 811 363"]]},
  {"id": "104", "name": "Tuek Thla Branch", "st": [["21937", "ON Somneang", "MS Officer", "Operating", "061 797 818"], ["27216", "ARN Sotheara", "MS Officer", "Operating", "88 477 4877"], ["27154", "KHIN Darong", "MS Officer", "Operating", "096 224 5219"]]},
  {"id": "105", "name": "Toul Kork Branch", "st": [["10811", "NI Oudomroth", "Senior MS Officer", "Operating", "093630583 / 0967680963"], ["27323", "SOEURK Chantrea", "MS Officer", "Operating", "(+855) 97 648 5022"], ["27401", "MAY Vandy", "MS Officer", "Pending", ""]]},
  {"id": "106", "name": "Central Branch", "st": [["18359", "CHHET Chhea", "MS Officer", "Operating", ""], ["27308", "LY Limneang", "MS Officer", "Operating", "086 884 000"], ["27446", "SANG Sopheary", "MS Officer", "Operating", "016 343 447"]]},
  {"id": "107", "name": "Stung Mean Chey Branch", "st": [["16457", "SOK Philip", "MS Officer", "Operating", "92 967 270"], ["27289", "MEY Sokchomroeun", "MS Officer", "Operating", "096 443 6412"], ["27228", "LI Piseth", "MS Officer", "Operating", "015 916 427"]]},
  {"id": "108", "name": "Independent Monument Branch", "st": [["19274", "SENG Menghor", "MS Officer", "Operating", ""], ["27801", "SOK Nary", "MS Officer", "Pending", ""], ["27378", "CHHIV Sreypov", "MS Officer", "Operating", "89 865 464"]]},
  {"id": "109", "name": "Chbar Ampov Branch", "st": [["27271", "VATH Vannnak", "MS Officer", "Operating", "76 246 8049"], ["27439", "SARA Thavrak", "MS Officer", "Operating", "070 324 557"], ["27273", "KHON Samnang", "MS Officer", "Pending", "68 580 892"]]},
  {"id": "110", "name": "Chaom Chau Branch", "st": [["14435", "HEANG Neavisal", "Senior MS Officer", "Operating", "097 337 8208"], ["27197", "SUN Chinda Muny", "MS Officer", "Operating", "(+855) 86 906 341"], ["27339", "SOY Sothearoth", "MS Officer", "Operating", "085 907 766"]]},
  {"id": "111", "name": "Samdach Sothearos Branch", "st": [["18086", "PHAL Sophorn", "MS Officer", "Operating", "(+855) 96 67 68 173"], ["27574", "PHAL Kanan", "MS Officer", "Operating", ""], ["27493", "CHHAT Soriya", "MS Officer", "Operating", ""]]},
  {"id": "112", "name": "Ou Baek K'am Branch", "st": [["17021", "KHON Rithy", "MS Officer", "Operating", "96 293 4083"], ["27309", "LY Bunchheang", "MS Officer", "Operating", ""], ["27419", "KONG Sophanith", "MS Officer", "Operating", "081 993 257"]]},
  {"id": "113", "name": "Saensokh Branch", "st": [["26059", "YONG Sokleap", "MS Officer", "Operating", ""], ["27199", "HIEM RIKA", "MS Officer", "Operating", "(+855) 96 970 4839"], ["27198", "PENG Panhapich", "MS Officer", "Operating", "(+855) 88 288 0798"]]},
  {"id": "114", "name": "Russey Keo Branch", "st": [["26233", "PHOEUN Phearun", "MS Officer", "Operating", "(+855) 96 414 0136"], ["27220", "MONG Laiza", "MS Officer", "Operating", "(+855) 81 656 820"], ["23941", "CHAK Sreinich", "MS Officer", "Operating", "088 2 617 937"]]},
  {"id": "115", "name": "Phsar Derm Thkov Branch", "st": [["26125", "HENG Menglay", "MS Officer", "Operating", ""], ["27278", "PREAB YADA", "MS Officer", "Operating", "069 561 234"], ["27384", "SEN Lai Heang", "MS Officer", "Operating", "96 546 4907"]]},
  {"id": "116", "name": "Santhor Mok Branch", "st": [["10220", "BIEN Verak", "Senior MS Officer", "Operating", "087 630 816"], ["27217", "HAK Nimol", "MS Officer", "Operating", ""], ["27207", "HOR Tengmeng", "MS Officer", "Operating", "97 497 1320"]]},
  {"id": "117", "name": "Chamkar Doung Branch", "st": [["17734", "CHHIEN Chhievthean", "MS Officer", "Operating", "(+855) 96 67 68 173"], ["27214", "LY Vanreth", "MS Officer", "Operating", ""], ["27215", "HOK Leangcheng", "MS Officer", "Operating", ""]]},
  {"id": "119", "name": "Chraoy Changvar Branch", "st": [["14434", "A Chanthorl", "Senior MS Officer", "Operating", "085 339 828 / 010 339 828"], ["27268", "CHEUNG Veythav", "MS Officer", "Operating", "016 434 800"], ["27297", "KHORN Nita", "MS Officer", "Operating", "88 296 9335"], ["27205", "VEN Porp", "MS Officer", "Operating", "88 401 4047"], ["27269", "PEN Nesa", "MS Officer", "Operating", "088 893 0561"]]},
  {"id": "120", "name": "Samdach Monireth Branch", "st": [["25987", "RIN Viraktitsya", "MS Officer", "Operating", "088 946 6510"], ["27149", "CHUB Karithy", "MS Officer", "Operating", "096 760 6978"], ["27213", "MEAK SreyMeas", "MS Officer", "Operating", "086 826 037"]]},
  {"id": "121", "name": "Chaom Chau 2 Branch", "st": [["27192", "SARORNG Hen", "MS Officer", "Operating", "(+855) 97 644 0456"], ["27184", "YON Dalin", "MS Officer", "Operating", "71 418 0043"], ["27802", "PHON Sina", "MS Officer", "Pending", ""]]},
  {"id": "122", "name": "Mittapheap Branch", "st": [["16191", "YIN Oun", "MS Officer", "Operating", "096 390 4113"], ["27299", "SOK VIMEAS", "MS Officer", "Operating", "069 253 165"], ["27495", "NGOUNHAS Sovisoth", "MS Officer", "Operating", "(+855) 17 771 257"]]},
  {"id": "123", "name": "Boeng Trabaek Branch", "st": [["23283", "KHORN Lakenathavreak", "MS Officer", "Operating", ""], ["27218", "ENG Sreynich", "MS Officer", "Operating", "99 231 730"], ["27245", "OU KHEMRA", "MS Officer", "Operating", ""]]},
  {"id": "124", "name": "Chaom Chau 3 Branch", "st": [["18216", "BITH Sogivon", "MS Officer", "Operating", "088 889 3239"], ["27291", "KHIN Phannet", "MS Officer", "Operating", "096 594 3647"], ["27380", "NAT Seakmeng", "MS Officer", "Operating", "015 458 184"]]},
  {"id": "126", "name": "Samraong Kraom Branch", "st": [["16134", "CHHORM Sreypun", "MS Officer", "Operating", ""], ["27434", "SEAK Reasey", "MS Officer", "Operating", "089 651 465"], ["27479", "KHEMKANN Chhorponreangsey", "MS Officer", "Operating", ""]]},
  {"id": "127", "name": "Stueng Mean Chey 2 Branch", "st": [["22439", "CHHUCH Chheurn", "MS Officer", "Operating", ""], ["27252", "LY VannRong", "MS Officer", "Operating", "067 724 403"], ["27350", "KOU Kalika", "MS Officer", "Operating", "093 668 027"]]},
  {"id": "129", "name": "Grand Phnom Penh Branch", "st": [["24013", "POV Veha", "MS Officer", "Operating", ""], ["27264", "RETH Rithvorn", "MS Officer", "Operating", "99 805 577"], ["27306", "NEUN Veasna", "MS Officer", "Operating", "86894727"]]},
  {"id": "130", "name": "Khan Praek Pnov Branch", "st": [["27349", "PAT Sokre", "MS Officer", "Operating", "089 219 024"], ["27461", "HEANG Thealykheang", "MS Officer", "Operating", "092 262 102"], ["27803", "SORN Cheatta", "MS Officer", "Operating", ""]]},
  {"id": "131", "name": "Kamboul Branch", "st": [["18215", "SIREN Botrey", "Senior MS Officer", "Operating", "(+855) 98 280 031"], ["27416", "SAM Chanrith", "MS Officer", "Operating", "097 674 9636"], ["27528", "YONG Sreypov", "MS Officer", "Operating", "068 909 169"]]},
  {"id": "132", "name": "Chamkar Mon Branch", "st": [["25986", "SUN Sotheara", "MS Officer", "Operating", "097 569 2902"], ["27266", "NEANG Sensamnang", "MS Officer", "Operating", "086 778 861"], ["27427", "SEANG Soksan", "MS Officer", "Operating", "071 515 2129"]]},
  {"id": "133", "name": "Nirouth Branch", "st": [["21939", "KIM Samart", "MS Officer", "Operating", ""], ["23700", "LONG Narith", "MS Officer", "Operating", "069 635 423"], ["27450", "SAO Dara", "MS Officer", "Operating", "(+855) 96 404 3096"]]},
  {"id": "134", "name": "Ou Baek K'am 2 Branch", "st": [["7460", "NGET Chanraksmey", "Senior MS Officer", "Operating", ""], ["27224", "HOR Thearine", "MS Officer", "Operating", "096 959 1599"], ["27200", "PHORN Sreykeo", "MS Officer", "Operating", "097 806 6508"]]},
  {"id": "801", "name": "Central Market Branch", "st": [["18646", "VANN Reaksmey", "MS Officer", "Operating", ""], ["27203", "PHAT Socheata", "MS Officer", "Operating", "11 924 827"], ["27226", "SENG Mean", "MS Officer", "Operating", "10 801 228"]]}
];

export function buildInitialUsers(): User[] {
  const users: User[] = [];
  let seq = 1;
  RAW_BRANCHES.forEach(b => {
    (b.st || []).forEach(row => {
      const empId = String(row[0] || `EMP-${seq}`);
      const name = String(row[1] || 'Staff Officer').trim();
      const position = String(row[2] || 'MS Officer').trim();
      const rawStatus = String(row[3] || 'Operating').trim();
      const status = rawStatus === 'Operating' ? 'Operating' : 'Pending';
      const contact = String(row[4] || '').trim();
      const isSuperAdmin = empId === '8986' || empId === '5546';
      const accessRole = isSuperAdmin ? 'SUPER_ADMIN' : b.id === '100' ? 'ADMIN' : 'BRANCH';
      users.push({
        uid: `USR-${empId}-${seq++}`,
        empId,
        name,
        label: `${name} (${empId})`,
        accessRole,
        branchId: b.id,
        branchName: b.name,
        position,
        contact,
        status,
        updatedAt: '2026-10-18'
      });
    });
  });
  return users;
}

export function buildInitialBranches(users: User[]): Branch[] {
  return RAW_BRANCHES.map(b => {
    const branchUsers = users.filter(u => u.branchId === b.id);
    const staff = branchUsers.filter(u => u.status !== 'Suspended').map(u => u.label);
    return {
      id: b.id,
      code: b.id,
      name: b.name,
      staff: staff.length > 0 ? staff : (branchUsers.map(u => u.label)),
      staffDetails: branchUsers
    };
  });
}

export const STAGE_META: Record<LifecycleStage, StageInfo> = {
  HQ_STOCK: {
    label: 'Admin HQ Stock (Branch Code 100)',
    badgeClassLight: 'bg-slate-100 text-slate-700 border-slate-300 font-bold',
    badgeClassDark: 'bg-slate-100 text-slate-700 border-slate-300 font-bold',
    short: 'Admin HQ Stock',
    color: '#334155'
  },
  BRANCH_RESERVE: {
    label: 'Branch Reserve',
    badgeClassLight: 'bg-[#003857] text-white border-[#002840] font-bold dark:bg-[#003857] dark:text-white dark:border-[#004b75]',
    badgeClassDark: 'bg-[#003857] text-white border-[#004b75] font-bold',
    short: 'Branch Reserve',
    color: '#003857'
  },
  CONFIGURING: {
    label: 'Configuring',
    badgeClassLight: 'bg-slate-100 text-slate-800 border-slate-300 font-bold',
    badgeClassDark: 'bg-slate-800 text-slate-100 border-slate-700 font-bold',
    short: 'Branch Config',
    color: '#475569'
  },
  COMPLETE: {
    label: 'Installed Live',
    badgeClassLight: 'bg-emerald-50 text-emerald-800 border-emerald-200 font-bold',
    badgeClassDark: 'bg-emerald-50 text-emerald-800 border-emerald-200 font-bold',
    short: 'Installed Live',
    color: '#0f766e'
  },
  FAULTY: {
    label: 'Faulty Hardware',
    badgeClassLight: 'bg-rose-50 text-rose-800 border-rose-200 font-bold',
    badgeClassDark: 'bg-rose-50 text-rose-800 border-rose-200 font-bold',
    short: 'Faulty',
    color: '#be123c'
  },
  LOST: {
    label: 'Device Lost',
    badgeClassLight: 'bg-amber-50 text-amber-800 border-amber-200 font-bold',
    badgeClassDark: 'bg-amber-50 text-amber-800 border-amber-200 font-bold',
    short: 'Device Lost',
    color: '#d97706'
  }
};

export const RAW_DEVICES: Array<{
  s: string;
  m: string;
  dt: string;
  b: string;
  stf: string;
  g: LifecycleStage;
  mid: string;
  tid: string;
  mn: string;
  mp: string;
  ad: string;
  dd: string;
  rr: string;
  rc: number;
}> = [
  {"s": "WP5400PQ23200297", "m": "Wizar POS Q2 Pro", "dt": "2024-09-12", "b": "101", "stf": "SEOUN Chettra (25490)", "g": "COMPLETE", "mid": "100000880101001", "tid": "TID-10101", "mn": "Borei Keyla Pharmacy", "mp": "089 591 091", "ad": "Borei Keyla St, 7 Makara", "dd": "2026-01-18", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200298", "m": "Wizar POS Q2 Pro", "dt": "2024-11-20", "b": "102", "stf": "HON Bunheng (17022)", "g": "COMPLETE", "mid": "100000880102001", "tid": "TID-10201", "mn": "Mondulkiri Coffee Mao Tse Toung", "mp": "088 927 265", "ad": "Mao Tse Toung Blvd, Chamkar Mon", "dd": "2026-02-14", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200299", "m": "Wizar POS Q2 Pro", "dt": "2026-03-10", "b": "105", "stf": "NI Oudomroth (10811)", "g": "COMPLETE", "mid": "100000880105001", "tid": "TID-10501", "mn": "Brown Coffee Toul Kork", "mp": "012 889 101", "ad": "St 315, Boeung Kak 1, Toul Kork", "dd": "2026-03-20", "rr": "", "rc": 1},
  {"s": "WP5400PQ23200300", "m": "Wizar POS Q2 Pro", "dt": "2026-04-12", "b": "106", "stf": "CHHET Chhea (18359)", "g": "COMPLETE", "mid": "100000880106001", "tid": "TID-10601", "mn": "Sorya Fashion Boutique", "mp": "086 884 000", "ad": "Preah Trasak Paem St (St 63), Daun Penh", "dd": "2026-04-25", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200301", "m": "Wizar POS Q2 Pro", "dt": "2026-05-10", "b": "113", "stf": "YONG Sokleap (26059)", "g": "COMPLETE", "mid": "100000880113001", "tid": "TID-11301", "mn": "Saensokh Superstore", "mp": "096 970 483", "ad": "Hanoi Blvd (1019), Sen Sok", "dd": "2026-05-15", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200302", "m": "Wizar POS Q2 Pro", "dt": "2026-08-04", "b": "108", "stf": "SENG Menghor (19274)", "g": "COMPLETE", "mid": "100000880108001", "tid": "TID-10801", "mn": "U-Care Pharmacy Monument", "mp": "089 865 464", "ad": "Preah Norodom Blvd, BKK1", "dd": "2026-08-19", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200303", "m": "Wizar POS Q2 Pro", "dt": "2026-09-05", "b": "105", "stf": "NI Oudomroth (10811)", "g": "CONFIGURING", "mid": "100000880105004", "tid": "TID-10504", "mn": "Starbucks Reserve TK", "mp": "012 900 411", "ad": "St 516, Toul Kork", "dd": "2026-10-17", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200304", "m": "Wizar POS Q2 Pro", "dt": "2026-10-01", "b": "105", "stf": "NI Oudomroth (10811)", "g": "BRANCH_RESERVE", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200305", "m": "Wizar POS Q2 Pro", "dt": "2026-06-14", "b": "105", "stf": "NI Oudomroth (10811)", "g": "BRANCH_RESERVE", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "2026-07-01", "rr": "Merchant Closed Business", "rc": 2},
  {"s": "WP5400PQ23200306", "m": "Wizar POS Q2 Pro", "dt": "2026-10-10", "b": "100", "stf": "SAY Chanmakara (8986)", "g": "HQ_STOCK", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200307", "m": "Wizar POS Q2 Pro", "dt": "2026-10-10", "b": "100", "stf": "SAY Chanmakara (8986)", "g": "HQ_STOCK", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200308", "m": "Wizar POS Q2 Pro", "dt": "2026-10-11", "b": "100", "stf": "CHHOEUN Seyha (5546)", "g": "HQ_STOCK", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200309", "m": "Wizar POS Q2 Pro", "dt": "2026-10-11", "b": "100", "stf": "CHHOEUN Seyha (5546)", "g": "HQ_STOCK", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200310", "m": "Wizar POS Q2 Pro", "dt": "2026-10-12", "b": "100", "stf": "CHHOEUN Seyha (5546)", "g": "HQ_STOCK", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200311", "m": "Wizar POS Q2 Pro", "dt": "2026-10-12", "b": "100", "stf": "SAY Chanmakara (8986)", "g": "HQ_STOCK", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200312", "m": "Wizar POS Q2 Pro", "dt": "2026-10-13", "b": "100", "stf": "SAY Chanmakara (8986)", "g": "HQ_STOCK", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200313", "m": "Wizar POS Q2 Pro", "dt": "2026-10-14", "b": "100", "stf": "CHHOEUN Seyha (5546)", "g": "HQ_STOCK", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200314", "m": "Wizar POS Q2 Pro", "dt": "2026-10-15", "b": "100", "stf": "CHHOEUN Seyha (5546)", "g": "HQ_STOCK", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "", "rr": "", "rc": 0},
  {"s": "WP5400PQ23200315", "m": "Wizar POS Q2 Pro", "dt": "2026-10-16", "b": "100", "stf": "SAY Chanmakara (8986)", "g": "HQ_STOCK", "mid": "", "tid": "", "mn": "", "mp": "", "ad": "", "dd": "", "rr": "", "rc": 0}
];

export function deriveBatterySerial(serial: string, isPos: boolean = true, index: number = 0): string {
  if (isPos) {
    // POS Battery Serial format sample: 160525A0005709
    const match = serial.match(/\d+$/);
    const offset = match ? Math.max(0, parseInt(match[0].slice(-4), 10) - 297) : index;
    const seq = String(5709 + offset).padStart(7, '0');
    return `160525A${seq}`;
  }
  const clean = serial.replace(/^(POS-|SB-)/i, '');
  return `SB-BAT-${clean}`;
}

export function buildInitialDevices(branches: Branch[]): Device[] {
  return RAW_DEVICES.map((d, idx) => {
    const bObj = branches.find(b => b.id === d.b) || branches[0];
    const isPos = true;
    const batterySerial = deriveBatterySerial(d.s, isPos, idx);
    const cycleEvents: string[] = [
      `${d.dt} 08:30:00 | Cycle #1: HQ Stock-In | Registered in Branch Code 100 (HQ Warehouse) · Battery: ${batterySerial} (24m cycle start) — Officer: SAY Chanmakara (8986)`,
    ];
    if (d.b !== '100') {
      cycleEvents.unshift(
        `${d.dt} 14:15:00 | Cycle #1: Branch Dispatch | Assigned to Branch Code ${d.b} (${bObj.name}) Reserve — Officer: ${d.stf}`
      );
    }
    if (d.mn) {
      cycleEvents.unshift(
        `${d.dd || "2026-10-15"} 11:20:00 | Cycle #${(d.rc || 0) + 1}: Merchant Installation | Installed at ${d.mn} (MID: ${d.mid}, TID: ${d.tid}) in Branch Code ${d.b} — Officer: ${d.stf}`
      );
    }
    if (d.rr) {
      cycleEvents.unshift(
        `${d.dd || "2026-10-16"} 16:40:00 | Cycle #${(d.rc || 0) + 1}: Return / RMA | Flagged "${d.rr}" in Branch Code ${d.b} — Ready for refurbishment or HQ return`
      );
    }

    return {
      serial: d.s,
      batterySerial,
      batteryInstalledDate: d.dt,
      type: "POS Terminal",
      model: d.m || "Wizar POS Q2 Pro",
      stockInDate: d.dt,
      branchId: d.b,
      branchName: bObj.name,
      staff: d.stf,
      installedByStaff: d.stf,
      replacedByStaff: (d.rc && d.rc > 0) ? (d.stf === 'NI Oudomroth (10811)' ? 'CHHOEUN Seyha (5546)' : 'SEOUN Chettra (25490)') : undefined,
      returnedByStaff: (d.rr || (d.rc && d.rc > 0 && d.g === 'BRANCH_RESERVE')) ? (d.stf === 'NI Oudomroth (10811)' ? 'SAY Chanmakara (8986)' : 'CHHOEUN Seyha (5546)') : undefined,
      stage: d.g,
      deploymentStatus: d.g === "COMPLETE" ? "Deployed" : (d.g === "BRANCH_RESERVE" || d.g === "HQ_STOCK" ? "In-Stock (Reserve)" : "In-process"),
      stockStatus: d.g === "COMPLETE" ? "At Merchant" : "In-Stock",
      mid: d.mid,
      tid: d.tid,
      merchantName: d.mn,
      merchantPhone: d.mp,
      location: "Phnom Penh",
      address: d.ad,
      deployedDate: d.dd,
      returnReason: d.rr,
      redeployCount: d.rc,
      hoursInStage: 12,
      updatedAt: d.dd || d.dt,
      note: d.mn ? `Assigned to ${d.mn} (${d.mid})` : `Stored in Branch Code ${d.b} (${bObj.name}) Reserve (Battery: ${batterySerial})`,
      history: cycleEvents,
      archived: false,
      integrityHash: `SHA256-${d.s}-${1000 + idx}`
    };
  });
}

export function createInitialRequisitions(): Requisition[] {
  return [
    {
      reqId: "REQ-2026-105",
      date: "2026-10-17 09:15",
      branchId: "105",
      branchName: "Toul Kork Branch",
      staff: "NI Oudomroth (10811)",
      posQty: 2,
      sbQty: 0,
      reason: "Branch Code 105 reserve replenishment for merchant POS Terminal installations",
      status: "PENDING_ADMIN"
    }
  ];
}

