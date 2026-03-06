import type { DocumentType } from "./types";
import {
  FIELD_LABELS_MK,
  TAX_FIELD_LABELS_MK,
  DDV_FIELD_LABELS_MK,
  PAYROLL_FIELD_LABELS_MK,
} from "./constants";

/** Single field definition for a document-type review form (key + Macedonian label). */
export interface DocumentTypeFieldDef {
  key: string;
  label: string;
}

/** Document type schema: id, display name, and ordered list of fields matching the Excel for that type. */
export interface DocumentTypeSchema {
  id: DocumentType;
  /** Macedonian title for the review page (e.g. "Фактури", "Даночен биланс"). */
  title: string;
  /** Fields in Excel column order — only these are shown on the Преглед page for this type. */
  fields: DocumentTypeFieldDef[];
}

function label(key: string, labels: Record<string, string>): string {
  return labels[key] ?? key;
}

/** Invoice (Фактури) — matches Example-Invoices.xlsx columns. */
const INVOICE_FIELDS: DocumentTypeFieldDef[] = [
  // Header row: "Тип на документ", "Број на документ", "Дата на документ",
  // "Продавач", "Купувач", "Опис во документ", "Нето износ", "ДДВ 18%", "Бруто износ"
  { key: "document_type", label: FIELD_LABELS_MK.document_type as string },
  { key: "invoice_number", label: FIELD_LABELS_MK.invoice_number as string },
  { key: "date", label: FIELD_LABELS_MK.date as string },
  { key: "seller_name", label: FIELD_LABELS_MK.seller_name as string },
  { key: "buyer_name", label: FIELD_LABELS_MK.buyer_name as string },
  { key: "description", label: FIELD_LABELS_MK.description as string },
  { key: "net_amount", label: FIELD_LABELS_MK.net_amount as string },
  { key: "tax_amount", label: FIELD_LABELS_MK.tax_amount as string },
  { key: "total_amount", label: FIELD_LABELS_MK.total_amount as string },
];

/** One row in the Даночен биланс form (template layout): section label, description, and optional field key for value. */
export interface TaxBalanceFormRow {
  section: string;
  description: string;
  fieldKey?: string;
}

/** Official section labels and descriptions for Даночен биланс (УТВРДУВАЊЕ НА ДАНОК ОД ДОБИВКА НА НЕПРИЗНАЕНИ РАСХОДИ). */
const TAX_BALANCE_ROW_DESCRIPTIONS: ReadonlyArray<{ section: string; description: string }> = [
  { section: "I.", description: "Финансиски резултат во Биланс на успех" },
  { section: "II.", description: "Непризнаени расходи за даночни цели (збир од АОП 03 до АОП 29)" },
  { section: "1", description: "Расходи кои не се поврзани со вршење на дејноста на субјектот односно не се непосреден услов за извршување на дејноста и не се последица од вршењето на дејноста" },
  { section: "2", description: "Исплатени надоместоци на трошоци и други лични примања од работен однос над утврдениот износ" },
  { section: "3", description: "Исплатени надоместоци на трошоци на вработените што не се утврдени со член 9 став 1 точка 2 од ЗДД" },
  { section: "4", description: "Трошоци за организирана исхрана и превоз исплатени над износите утврдени со закон" },
  { section: "5", description: "Трошоци за сместување и превоз за невработени лица кои не се документирани согласно член 9 став 1 точка 2 од ЗДД" },
  { section: "6", description: "Трошоци за исхрана на вработените кои работат ноќно време, над износите утврдени со закон" },
  { section: "7", description: "Трошоци по основ на месечни надоместоци на членови на органи на управување над висината утврдена со закон" },
  { section: "8", description: "Трошоци по основ на уплатени доброволни придонеси во доброволен пензиски фонд над висината утврдена со закон" },
  { section: "9", description: "Трошоци по основ на уплатени премии за осигурување на живот над висината утврдена со закон" },
  { section: "10", description: "Надоместоци за лица волонтери и за лица ангажирани за вршење на јавни работи над износите утврдени со закон" },
  { section: "11", description: "Скриени исплати на добивки" },
  { section: "12", description: "Кусоци кои не се предизвикани од вонредни настани (кражба, пожар или други природни непогоди)" },
  { section: "13", description: "Трошоци за репрезентација" },
  { section: "14", description: "Вкупни трошоци за донации од Законот за донации и спонзорства во јавните дејности, освен износот на донациите за кои се користи данчно ослободување до 5% од вкупниот приход остварен во годината" },
  { section: "15", description: "Трошоци за спонзорства направени во согласност со Законот за донации и спонзорства во јавните дејности, над 3% од вкупниот приход остварен во годината" },
  { section: "16", description: "Трошоци за донации во спортот согласно член 30-а и 30-б од ЗДД" },
  { section: "17", description: "Трошоци по основ на камата по кредити кои не се користат за вршење на дејноста на обврзникот" },
  { section: "18", description: "Осигурителни премии кои ги плаќа работодавачот во корист на членови на органите на управување, и на вработени" },
  { section: "19", description: "Даноци по задршка (одбивка) исплатени во име на трети лица кои се на товар на трошоците на обврзник" },
  { section: "20", description: "Парични и даночни казни, пенали и казнени камати за ненавремена уплата на јавни давачки и на трошоци за присилна наплата" },
  { section: "21", description: "Исплати на стипендии" },
  { section: "22", description: "Трошоци на кало, растур, крш и расипување" },
  { section: "23", description: "Траен отпис на ненаплатени побарувања" },
  { section: "24", description: "Трошоци за нето износот на примањата по основ на деловна успешност над износот на кој се пресметани придонеси согласно закон" },
  { section: "25", description: "Трошоци за практикантска работа нас износот пропишан по закон за практиканство" },
  { section: "26", description: "Трошоци за практична обука на ученици и практична настава на студенти во висина над 8.000 мкд" },
  { section: "27", description: "Трошоци за амортизација на ревалоризираната вредност на материјални и нематеријални средства" },
  { section: "28", description: "Трошоци за амортиација и ревалоризација на материјални и нематеријални средства која е повисока од амортизацијата пресметана на набавната вредност со примена на стапките на пропишаните согласно номенклатура на средствата за амортизација" },
  { section: "29", description: "Преостаната сегашна вредност на основните средства кои не се користат, а се амортизираат во целост за кои не е издадена согласност од управата за јавни приходи" },
  { section: "30", description: "Трошоци за исправка на вредноста на ненаплатени побарувања" },
  { section: "31", description: "Износ на ненаплатени побарувања од заем" },
  { section: "32", description: "Износ на позитивна разлика меѓу расходите кои произлегуваат од трансакција по трансферна цена и расходите кои произлегуваат од таа трансакција по пазарна цена  утврдена по принципот на дофат на рака меѓу поврзани лица" },
  { section: "33", description: "Износ на позитивна разлика меѓу приходите кои произлегуваат од трансакција по трансферна цена и приходите кои произлегуваат од таа трансакција по пазарна цена  утврдена по принципот на дофат на рака меѓу поврзани лица" },
  { section: "34", description: "Износ на дел од камати по заеми кои се добиени од поврзано лице кое не е банка или друга овластена кредитна институција, кој го надминува износот кој би се остварил доколку се работи за неповрзани лица" },
  { section: "35", description: "Износ на затезни камати кои произлегуваат од односите со поврзано лице кое не е банка или друга овластена кредитна институција" },
  { section: "36", description: "Износ на камати на заеми добиени од содружници или акционери – нерезиденти со најмалку од 25% учество во капиталот" },
  { section: "37", description: "Други усогласувања на расходи" },
  { section: "III.", description: "Даночна основа (I+II)" },
  { section: "IV.", description: "Намалување на даночна основа (АОП 32+АОП33+АОП34+АОП35+АОП36)" },
  { section: "38", description: "Износ на наплатени побарувања за кои во претходниот период е зголемена даночната основа" },
  { section: "39", description: "Износ на вратен дел од заем за кои во претходните даночни периоди било извршено зголемување на даночната основа" },
  { section: "40", description: "Износ на трошоците на амортизација над износот пресметан во примена на амортизациони стапки утврдени со номенклатурата на средствата за амортизација и годишните амортизациони стапки за кои во претходниот период е извршено зголемување на даночната основа" },
  { section: "41", description: "Износ на неисплатени надоместоци над износите утврдени во член 9 став 1 точки 2) 3-б) 4) 5) 5-а) и б), од ЗДД , за кои во претходниот период е извршено зголемување на даночната основа, доколку истите се искажани како приход" },
  { section: "42", description: "Дивиденди остварени со учество во капиталот на друг даночен обврзник, оданочени со данок на добивка кај исплатувачот" },
  { section: "43", description: "Дел од загуба намалена за непризнаени расходи, пренесена од претходни години" },
  { section: "44", description: "Износ на извршени вложувања од добивката (реинвестирана)" },
  { section: "V.", description: "Даночна основа по намалување (III- IV)" },
  { section: "VI.", description: "Пресметан данок на добивка (V x 10%)" },
  { section: "VII.", description: "Намалување на пресметаниот данок на добивка (АОП40+АОП41+АОП42+АОП43)" },
  { section: "45", description: "Намалување на данокот за вредноста на набавени и ставени во употреба до 10 фискални системи на опрема за регистрирање на готовински плаќања" },
  { section: "46", description: "Износ на данок содржан во оданочени приходи/ добивки во странство (withholding tax) до пропишаната стапка" },
  { section: "47", description: "Данок кој го платила подружницата во странство за добивката вклучена во приходите на матичното правно лице во Р.М. но не повеќе од износот на данокот по пропишаната стапка во ЗДД" },
  { section: "48", description: "Износ на пресметано даночно олеснување за дадена донација утврдена во согласност со членовите 30-а и 30-б од ЗДД" },
  { section: "VIII.", description: "Пресметан данок по намалување (VI-VII)" },
  { section: "49", description: "Платени аконтации на данокот на добивка за даночниот период" },
  { section: "50", description: "Износ на повеќе платен данок на добивка пренесен од претходните даночни периоди" },
  { section: "51", description: "Износ за доплата / повеќе платен износ (АОП 44 - АОП 45 - АОП 46)" },
];

/** AOP field keys aop_1..aop_59 for FullTaxBalanceAnalyzer schema. */
export const TAX_BALANCE_AOP_KEYS = Object.freeze(
  Array.from({ length: 59 }, (_, i) => `aop_${i + 1}`)
);

/** Даночен биланс (Tax balance) — FullTaxBalanceAnalyzer: 4 metadata + 59 AOP lines. */
const TAX_BALANCE_FIELDS: DocumentTypeFieldDef[] = [
  { key: "companyName", label: label("companyName", TAX_FIELD_LABELS_MK) },
  { key: "companyTaxId", label: label("companyTaxId", TAX_FIELD_LABELS_MK) },
  { key: "taxPeriodStart", label: label("taxPeriodStart", TAX_FIELD_LABELS_MK) },
  { key: "taxPeriodEnd", label: label("taxPeriodEnd", TAX_FIELD_LABELS_MK) },
  // For AOP 1–59 use the official row descriptions from the Даночен биланс form
  // so the side panel and batch cards show the same text as the Excel/PDF,
  // not just "АОП N".
  ...TAX_BALANCE_AOP_KEYS.map((key, i) => ({
    key,
    label: TAX_BALANCE_ROW_DESCRIPTIONS[i]?.description ?? key,
  })),
];

/** Form layout for Преглед — official section + description per AOP line; value column maps to Excel column D. */
export const TAX_BALANCE_FORM_ROWS: TaxBalanceFormRow[] = TAX_BALANCE_AOP_KEYS.map((key, i) => ({
  section: TAX_BALANCE_ROW_DESCRIPTIONS[i]?.section ?? String(i + 1),
  description: TAX_BALANCE_ROW_DESCRIPTIONS[i]?.description ?? `АОП ${i + 1}`,
  fieldKey: key,
}));

/** Excel row (1-based) for each Даночен биланс field in РД-Данок на добивка — value in column D. aop_1=10, aop_2=11, …, aop_59=68. */
export const TAX_BALANCE_EXCEL_ROW_MAP: Record<string, number> = Object.fromEntries([
  ...TAX_BALANCE_AOP_KEYS.map((key, i) => [key, 10 + i]),
]);

/** ДДВ (VAT return) — matches РД-ДДВ Excel. */
const DDV_FIELDS: DocumentTypeFieldDef[] = [
  // Metadata (shown in forms, not part of official 01–20 column set)
  { key: "taxPeriod", label: label("taxPeriod", DDV_FIELD_LABELS_MK) },
  { key: "companyName", label: label("companyName", DDV_FIELD_LABELS_MK) },
  { key: "companyTaxId", label: label("companyTaxId", DDV_FIELD_LABELS_MK) },
  // Boxes 01–11 (излезен ДДВ, acc.# 230)
  { key: "prometOpshtaStapkaOsnova", label: label("prometOpshtaStapkaOsnova", DDV_FIELD_LABELS_MK) },
  { key: "prometOpshtaStapkaDDV", label: label("prometOpshtaStapkaDDV", DDV_FIELD_LABELS_MK) },
  { key: "prometPovlastenaStapka10Osnova", label: label("prometPovlastenaStapka10Osnova", DDV_FIELD_LABELS_MK) },
  { key: "prometPovlastenaStapka10DDV", label: label("prometPovlastenaStapka10DDV", DDV_FIELD_LABELS_MK) },
  { key: "prometPovlastenaStapka5Osnova", label: label("prometPovlastenaStapka5Osnova", DDV_FIELD_LABELS_MK) },
  { key: "prometPovlastenaStapka5DDV", label: label("prometPovlastenaStapka5DDV", DDV_FIELD_LABELS_MK) },
  { key: "izvoz", label: label("izvoz", DDV_FIELD_LABELS_MK) },
  { key: "oslobodenSOPravoNaOdbivka", label: label("oslobodenSOPravoNaOdbivka", DDV_FIELD_LABELS_MK) },
  { key: "oslobodenBezPravoNaOdbivka", label: label("oslobodenBezPravoNaOdbivka", DDV_FIELD_LABELS_MK) },
  { key: "prometNerezidentiNeOdanocliv", label: label("prometNerezidentiNeOdanocliv", DDV_FIELD_LABELS_MK) },
  { key: "prometPrenesuvanjeDanocnaObvrska", label: label("prometPrenesuvanjeDanocnaObvrska", DDV_FIELD_LABELS_MK) },
  { key: "primenPrometNerezidentiOpshtaOsnova", label: label("primenPrometNerezidentiOpshtaOsnova", DDV_FIELD_LABELS_MK) },
  { key: "primenPrometNerezidentiOpshtaDDV", label: label("primenPrometNerezidentiOpshtaDDV", DDV_FIELD_LABELS_MK) },
  { key: "primenPrometNerezidentiPovlastenaOsnova", label: label("primenPrometNerezidentiPovlastenaOsnova", DDV_FIELD_LABELS_MK) },
  { key: "primenPrometNerezidentiPovlastenaDDV", label: label("primenPrometNerezidentiPovlastenaDDV", DDV_FIELD_LABELS_MK) },
  { key: "primenPrometZemjaOpshtaOsnova", label: label("primenPrometZemjaOpshtaOsnova", DDV_FIELD_LABELS_MK) },
  { key: "primenPrometZemjaOpshtaDDV", label: label("primenPrometZemjaOpshtaDDV", DDV_FIELD_LABELS_MK) },
  { key: "primenPrometZemjaPovlastenaOsnova", label: label("primenPrometZemjaPovlastenaOsnova", DDV_FIELD_LABELS_MK) },
  { key: "primenPrometZemjaPovlastenaDDV", label: label("primenPrometZemjaPovlastenaDDV", DDV_FIELD_LABELS_MK) },
  // Boxes 21–31 (влезен ДДВ и даночен долг, acc.# 130)
  { key: "vlezenPrometOsnova", label: label("vlezenPrometOsnova", DDV_FIELD_LABELS_MK) },
  { key: "vlezenPrometDDV", label: label("vlezenPrometDDV", DDV_FIELD_LABELS_MK) },
  { key: "vlezenPrometPrijamatelStranstvoOsnova", label: label("vlezenPrometPrijamatelStranstvoOsnova", DDV_FIELD_LABELS_MK) },
  { key: "vlezenPrometPrijamatelStranstvoDDV", label: label("vlezenPrometPrijamatelStranstvoDDV", DDV_FIELD_LABELS_MK) },
  { key: "vlezenPrometPrijamatelZemjaOsnova", label: label("vlezenPrometPrijamatelZemjaOsnova", DDV_FIELD_LABELS_MK) },
  { key: "vlezenPrometPrijamatelZemjaDDV", label: label("vlezenPrometPrijamatelZemjaDDV", DDV_FIELD_LABELS_MK) },
  { key: "uvozOsnova", label: label("uvozOsnova", DDV_FIELD_LABELS_MK) },
  { key: "uvozDDV", label: label("uvozDDV", DDV_FIELD_LABELS_MK) },
  { key: "prethodniDanociZaOdbivanje", label: label("prethodniDanociZaOdbivanje", DDV_FIELD_LABELS_MK) },
  { key: "ostanatiDanociIznosiZaOdbivanje", label: label("ostanatiDanociIznosiZaOdbivanje", DDV_FIELD_LABELS_MK) },
  { key: "danochenDolgIliPobaruvanje", label: label("danochenDolgIliPobaruvanje", DDV_FIELD_LABELS_MK) },
  // Summary + description at the end
  { key: "totalTaxBase", label: label("totalTaxBase", DDV_FIELD_LABELS_MK) },
  { key: "totalOutputVat", label: label("totalOutputVat", DDV_FIELD_LABELS_MK) },
  { key: "totalInputVat", label: label("totalInputVat", DDV_FIELD_LABELS_MK) },
  { key: "vatPayableOrRefund", label: label("vatPayableOrRefund", DDV_FIELD_LABELS_MK) },
  { key: "description", label: label("description", DDV_FIELD_LABELS_MK) },
];

/** Column order for DDВ Excel export – matches РД-ДДВ template (Период, 01–19, Вкупно, Ред.). */
export const DDV_EXCEL_COLUMN_KEYS: string[] = [
  "taxPeriod",
  "prometOpshtaStapkaOsnova",
  "prometOpshtaStapkaDDV",
  "prometPovlastenaStapka10Osnova",
  "prometPovlastenaStapka10DDV",
  "prometPovlastenaStapka5Osnova",
  "prometPovlastenaStapka5DDV",
  "izvoz",
  "oslobodenSOPravoNaOdbivka",
  "oslobodenBezPravoNaOdbivka",
  "prometNerezidentiNeOdanocliv",
  "prometPrenesuvanjeDanocnaObvrska",
  "primenPrometNerezidentiOpshtaOsnova",
  "primenPrometNerezidentiOpshtaDDV",
  "primenPrometNerezidentiPovlastenaOsnova",
  "primenPrometNerezidentiPovlastenaDDV",
  "primenPrometZemjaOpshtaOsnova",
  "primenPrometZemjaOpshtaDDV",
  "primenPrometZemjaPovlastenaOsnova",
  "primenPrometZemjaPovlastenaDDV",
  "totalOutputVat",
  "rowOrder",
];

/** Headers for DDВ Excel export – exact match to РД-ДДВ-Example.xlsx (official sub-header row). */
export const DDV_EXCEL_HEADERS: string[] = [
  "Период",
  "Даночна основа без ДДВ",
  "ДДВ",
  "Даночна основа без ДДВ",
  "ДДВ",
  "Даночна основа без ДДВ",
  "ДДВ",
  "Извоз",
  "Промет ослободен од данок со право на одбивка на претходен данок",
  "Промет ослободен од данок без право на одбивка на претходен данок",
  "Промет извршен спрема даночни обврзници кои немаат седиште во земјата, кој не е предмет на оданочување во земјата",
  "Промет во земјата за кој данокот го пресметува примателот на прометот (пренесување на даночна обврска согласно член 32-а)",
  "Даночна основа без ДДВ",
  "ДДВ",
  "Даночна основа без ДДВ",
  "ДДВ",
  "Даночна основа без ДДВ",
  "ДДВ",
  "Даночна основа без ДДВ",
  "ДДВ",
  "Вкупно",
  "Реф.",
];

/** Плати (Payroll) — matches schemas/MacedonianPayrollAnalyzer.json fieldSchema (РД-Трошоци за вработени). */
const PAYROLL_FIELDS: DocumentTypeFieldDef[] = [
  { key: "companyName", label: label("companyName", PAYROLL_FIELD_LABELS_MK) },
  { key: "companyTaxId", label: label("companyTaxId", PAYROLL_FIELD_LABELS_MK) },
  { key: "declarationPeriod", label: label("declarationPeriod", PAYROLL_FIELD_LABELS_MK) },
  { key: "brojVraboteni", label: label("brojVraboteni", PAYROLL_FIELD_LABELS_MK) },
  { key: "brutoPlata", label: label("brutoPlata", PAYROLL_FIELD_LABELS_MK) },
  { key: "pridonesPIO", label: label("pridonesPIO", PAYROLL_FIELD_LABELS_MK) },
  { key: "pridonesZdravstvo", label: label("pridonesZdravstvo", PAYROLL_FIELD_LABELS_MK) },
  { key: "pridonesProfesionalnoZaboluvanje", label: label("pridonesProfesionalnoZaboluvanje", PAYROLL_FIELD_LABELS_MK) },
  { key: "pridonesVrabotuvanje", label: label("pridonesVrabotuvanje", PAYROLL_FIELD_LABELS_MK) },
  { key: "personalenDanok", label: label("personalenDanok", PAYROLL_FIELD_LABELS_MK) },
  { key: "vkupnaNetoPlata", label: label("vkupnaNetoPlata", PAYROLL_FIELD_LABELS_MK) },
];

export const DOCUMENT_TYPE_SCHEMAS: Record<DocumentType, DocumentTypeSchema> = {
  faktura: {
    id: "faktura",
    title: "Фактура",
    fields: INVOICE_FIELDS,
  },
  smetka: {
    id: "smetka",
    title: "Даночен биланс",
    fields: TAX_BALANCE_FIELDS,
  },
  generic: {
    id: "generic",
    title: "ДДВ",
    fields: DDV_FIELDS,
  },
  plata: {
    id: "plata",
    title: "Плати",
    fields: PAYROLL_FIELDS,
  },
};

/** Normalize documentType string (from OCR or history) to DocumentType id. */
export function normalizeDocumentType(value: string | undefined): DocumentType {
  if (!value || !value.trim()) return "faktura";
  const v = value.trim().toLowerCase();
  if (v === "faktura" || v === "фактура" || v === "invoice" || v === "invoices") return "faktura";
  if (v === "smetka" || v === "сметка" || v === "даночен биланс" || v === "даноченбиланс") return "smetka";
  if (v === "generic" || v === "ддв" || v === "ddv" || v === "општо") return "generic";
  if (v === "plata" || v === "плата" || v === "плати" || v === "payroll") return "plata";
  return "faktura";
}

/** Get schema for a document type. */
export function getSchemaForDocumentType(documentType: string | undefined): DocumentTypeSchema {
  const id = normalizeDocumentType(documentType);
  return DOCUMENT_TYPE_SCHEMAS[id];
}
