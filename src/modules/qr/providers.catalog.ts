/**
 * Authoritative Provider & Banking Catalog
 *
 * Source of Truth:
 * - STEP 1.1 Provider Enumeration
 * - STEP 2 Reconciled Specification (34 Slip2Go codes / 38 entities)
 * - Bank of Thailand (BOT) Standardized Interbank Institution Codes
 */

export interface BankInstitution {
  botCode: string;          // 3-digit BOT code (e.g. '004')
  slip2goAccountType: string;// 5-digit Slip2Go code (e.g. '01004')
  nameTh: string;
  nameEn: string;
  shortName: string;
  category: 'COMMERCIAL' | 'STATE_OWNED';
}

export interface NonBankProvider {
  slip2goAccountType: string;
  nameTh: string;
  nameEn: string;
  shortName: string;
  category: 'E_WALLET' | 'CROSS_BORDER' | 'MERCHANT_AGGREGATOR';
}

/**
 * 29 Authoritative Thai Banking Institutions supported by Slip2Go & BOT Interbank clearing.
 * 24 Commercial Banks + 5 State-Owned / Specialized Financial Institutions (SFIs).
 */
export const AUTHORIZED_BOT_BANKS: Record<string, BankInstitution> = {
  // Commercial Banks (24)
  '002': { botCode: '002', slip2goAccountType: '01002', nameTh: 'ธนาคารกรุงเทพ', nameEn: 'Bangkok Bank', shortName: 'BBL', category: 'COMMERCIAL' },
  '004': { botCode: '004', slip2goAccountType: '01004', nameTh: 'ธนาคารกสิกรไทย', nameEn: 'Kasikorn Bank', shortName: 'KBANK', category: 'COMMERCIAL' },
  '006': { botCode: '006', slip2goAccountType: '01006', nameTh: 'ธนาคารกรุงไทย', nameEn: 'Krung Thai Bank', shortName: 'KTB', category: 'COMMERCIAL' },
  '008': { botCode: '008', slip2goAccountType: '01008', nameTh: 'ธนาคารเจพีมอร์แกน เชส', nameEn: 'JPMorgan Chase Bank', shortName: 'JPMC', category: 'COMMERCIAL' },
  '011': { botCode: '011', slip2goAccountType: '01011', nameTh: 'ธนาคารทหารไทยธนชาต', nameEn: 'TMBThanachart Bank', shortName: 'TTB', category: 'COMMERCIAL' },
  '014': { botCode: '014', slip2goAccountType: '01014', nameTh: 'ธนาคารไทยพาณิชย์', nameEn: 'Siam Commercial Bank', shortName: 'SCB', category: 'COMMERCIAL' },
  '017': { botCode: '017', slip2goAccountType: '01017', nameTh: 'ธนาคารซิตี้แบงก์', nameEn: 'Citibank Thailand', shortName: 'CITI', category: 'COMMERCIAL' },
  '018': { botCode: '018', slip2goAccountType: '01018', nameTh: 'ธนาคารซูมิโตโม มิตซุย', nameEn: 'Sumitomo Mitsui Banking Corp', shortName: 'SMBC', category: 'COMMERCIAL' },
  '020': { botCode: '020', slip2goAccountType: '01020', nameTh: 'ธนาคารสแตนดาร์ดชาร์เตอร์ด (ไทย)', nameEn: 'Standard Chartered Bank Thai', shortName: 'SCBT', category: 'COMMERCIAL' },
  '022': { botCode: '022', slip2goAccountType: '01022', nameTh: 'ธนาคารซีไอเอ็มบี ไทย', nameEn: 'CIMB Thai Bank', shortName: 'CIMBT', category: 'COMMERCIAL' },
  '024': { botCode: '024', slip2goAccountType: '01024', nameTh: 'ธนาคารยูโอบี', nameEn: 'United Overseas Bank Thai', shortName: 'UOBT', category: 'COMMERCIAL' },
  '025': { botCode: '025', slip2goAccountType: '01025', nameTh: 'ธนาคารกรุงศรีอยุธยา', nameEn: 'Bank of Ayudhya', shortName: 'BAY', category: 'COMMERCIAL' },
  '029': { botCode: '029', slip2goAccountType: '01029', nameTh: 'ธนาคารอินเดียนโอเวอร์ซีส์', nameEn: 'Indian Overseas Bank', shortName: 'IOBA', category: 'COMMERCIAL' },
  '031': { botCode: '031', slip2goAccountType: '01031', nameTh: 'ธนาคารฮ่องกงและเซี่ยงไฮ้แบงกิ้ง', nameEn: 'HSBC Thailand', shortName: 'HSBC', category: 'COMMERCIAL' },
  '032': { botCode: '032', slip2goAccountType: '01032', nameTh: 'ธนาคารดอยซ์แบงก์ เอจี', nameEn: 'Deutsche Bank AG', shortName: 'DB', category: 'COMMERCIAL' },
  '039': { botCode: '039', slip2goAccountType: '01039', nameTh: 'ธนาคารมิซูโฮ', nameEn: 'Mizuho Bank Bangkok Branch', shortName: 'MIZUHO', category: 'COMMERCIAL' },
  '045': { botCode: '045', slip2goAccountType: '01045', nameTh: 'ธนาคารบีเอ็นพี พารีบาส์', nameEn: 'BNP Paribas Bangkok Branch', shortName: 'BNPP', category: 'COMMERCIAL' },
  '052': { botCode: '052', slip2goAccountType: '01052', nameTh: 'ธนาคารแห่งประเทศจีน (ไทย)', nameEn: 'Bank of China Thai', shortName: 'BOC', category: 'COMMERCIAL' },
  '067': { botCode: '067', slip2goAccountType: '01067', nameTh: 'ธนาคารทิสโก้', nameEn: 'TISCO Bank', shortName: 'TISCO', category: 'COMMERCIAL' },
  '069': { botCode: '069', slip2goAccountType: '01069', nameTh: 'ธนาคารเกียรตินาคินภัทร', nameEn: 'Kiatnakin Phatra Bank', shortName: 'KKP', category: 'COMMERCIAL' },
  '070': { botCode: '070', slip2goAccountType: '01070', nameTh: 'ธนาคารไอซีบีซี (ไทย)', nameEn: 'ICBC Thai', shortName: 'ICBC', category: 'COMMERCIAL' },
  '071': { botCode: '071', slip2goAccountType: '01071', nameTh: 'ธนาคารไทยเครดิต', nameEn: 'Thai Credit Bank', shortName: 'TCRB', category: 'COMMERCIAL' },
  '073': { botCode: '073', slip2goAccountType: '01073', nameTh: 'ธนาคารแลนด์ แอนด์ เฮ้าส์', nameEn: 'Land and Houses Bank', shortName: 'LH Bank', category: 'COMMERCIAL' },
  '088': { botCode: '088', slip2goAccountType: '01088', nameTh: 'ธนาคารคลิกซ์', nameEn: 'CLICX Bank (Digital / Virtual)', shortName: 'CLICX', category: 'COMMERCIAL' },

  // State-Owned / Specialized Financial Institutions (5)
  '030': { botCode: '030', slip2goAccountType: '01030', nameTh: 'ธนาคารออมสิน', nameEn: 'Government Savings Bank', shortName: 'GSB', category: 'STATE_OWNED' },
  '033': { botCode: '033', slip2goAccountType: '01033', nameTh: 'ธนาคารอาคารสงเคราะห์', nameEn: 'Government Housing Bank', shortName: 'GHB', category: 'STATE_OWNED' },
  '034': { botCode: '034', slip2goAccountType: '01034', nameTh: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', nameEn: 'Bank for Agriculture and Agricultural Cooperatives', shortName: 'BAAC', category: 'STATE_OWNED' },
  '066': { botCode: '066', slip2goAccountType: '01066', nameTh: 'ธนาคารอิสลามแห่งประเทศไทย', nameEn: 'Islamic Bank of Thailand', shortName: 'ISBT', category: 'STATE_OWNED' },
  '098': { botCode: '098', slip2goAccountType: '01098', nameTh: 'ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อมฯ', nameEn: 'SME Development Bank', shortName: 'SME Bank', category: 'STATE_OWNED' },
};

/**
 * 5 Non-Bank and Cross-Border Providers supported by Slip2Go.
 */
export const AUTHORIZED_NON_BANK_PROVIDERS: Record<string, NonBankProvider> = {
  '02001': { slip2goAccountType: '02001', nameTh: 'ทรูมันนี่ วอลเล็ท', nameEn: 'TrueMoney Wallet', shortName: 'TrueMoney', category: 'E_WALLET' },
  '02003': { slip2goAccountType: '02003', nameTh: 'ช้อปปี้เพย์', nameEn: 'ShopeePay', shortName: 'ShopeePay', category: 'E_WALLET' },
  '02004': { slip2goAccountType: '02004', nameTh: 'แรบบิท ไลน์ เพย์', nameEn: 'Rabbit LINE Pay', shortName: 'RLP', category: 'E_WALLET' },
  '03000': { slip2goAccountType: '03000', nameTh: 'พร้อมเพย์ระหว่างประเทศ', nameEn: 'Cross-Border QR', shortName: 'XBORDER', category: 'CROSS_BORDER' },
  '04000': { slip2goAccountType: '04000', nameTh: 'ผู้ให้บริการรับชำระเงิน / ตัวแทนร้านค้า', nameEn: 'Merchant Aggregator', shortName: 'AGGREGATOR', category: 'MERCHANT_AGGREGATOR' },
};

/**
 * Exactly 34 distinct Slip2Go accountType codes (29 Banks + 5 Non-Banks)
 */
export const ALL_SLIP2GO_ACCOUNT_TYPES = [
  ...Object.values(AUTHORIZED_BOT_BANKS).map((b) => b.slip2goAccountType),
  ...Object.keys(AUTHORIZED_NON_BANK_PROVIDERS),
] as const;

/**
 * National ITMX Application Provider Identifiers (AIDs).
 * These AIDs belong to Merchant-Presented Payment QRs, NOT bank slips.
 */
export const KNOWN_PAYMENT_AIDS = {
  PROMPTPAY_CREDIT_TRANSFER: 'A000000677010111', // Tag 29
  PROMPTPAY_BILL_PAYMENT: 'A000000677010112',     // Tag 30
} as const;

/**
 * Validates whether a 3-digit code is an authorized Thai bank institution.
 */
export function isAuthorizedBankCode(botCode: string): boolean {
  if (!botCode || botCode.length !== 3) return false;
  return Object.prototype.hasOwnProperty.call(AUTHORIZED_BOT_BANKS, botCode);
}

/**
 * Retrieves bank metadata by 3-digit BOT code.
 */
export function getBankByBotCode(botCode: string): BankInstitution | undefined {
  return AUTHORIZED_BOT_BANKS[botCode];
}
