import { messagingApi } from '@line/bot-sdk';

export interface DraftConfirmItem {
  draftId: string;
  amount: number;
  category: string;
  merchant: string;
}

/**
 * Builds a single Flex Bubble component for a transaction draft.
 */
export function buildDraftConfirmBubble(
  draftId: string,
  amount: number,
  category: string,
  merchant: string
): messagingApi.FlexBubble {
  const formattedAmount = Number(amount).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: '📝 รายการรอยืนยัน',
          weight: 'bold',
          color: '#1DB446',
          size: 'sm',
        },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'md',
          contents: [
            {
              type: 'text',
              text: `฿${formattedAmount}`,
              size: 'xxl',
              color: '#111111',
              weight: 'bold',
            },
          ],
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: `🏷️ ${category || 'ทั่วไป'}`,
              size: 'md',
              color: '#8C8C8C',
            },
          ],
        },
        {
          type: 'text',
          text: merchant || '-',
          size: 'sm',
          color: '#aaaaaa',
          wrap: true,
          margin: 'sm',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#1DB446',
          action: {
            type: 'postback',
            label: '✅ ยืนยัน',
            data: `action=confirm&draft_id=${draftId}`,
            displayText: '✅ ยืนยันรายการ',
          },
        },
        {
          type: 'button',
          style: 'secondary',
          action: {
            type: 'postback',
            label: '✏️ แก้ไข',
            data: `action=edit&draft_id=${draftId}`,
            displayText: '✏️ ขอแก้ไขรายการ',
          },
        },
        {
          type: 'button',
          style: 'secondary',
          color: '#FF334B',
          action: {
            type: 'postback',
            label: '❌ ยกเลิก',
            data: `action=cancel&draft_id=${draftId}`,
            displayText: '❌ ยกเลิกรายการ',
          },
        },
      ],
    },
  };
}

/**
 * Builds a Flex Message for a single draft confirmation.
 */
export function buildDraftConfirmFlex(
  draftId: string,
  amount: number,
  category: string,
  merchant: string
): messagingApi.FlexMessage {
  return {
    type: 'flex',
    altText: '📝 รายการรอยืนยัน',
    contents: buildDraftConfirmBubble(draftId, amount, category, merchant),
  };
}

/**
 * Builds a Flex Message Carousel for multiple drafts confirmation.
 */
export function buildDraftsConfirmCarousel(
  items: DraftConfirmItem[]
): messagingApi.FlexMessage {
  if (items.length === 1) {
    return buildDraftConfirmFlex(
      items[0].draftId,
      items[0].amount,
      items[0].category,
      items[0].merchant
    );
  }

  // LINE Flex Carousel supports up to 10 bubbles
  const bubbles = items.slice(0, 10).map((item) =>
    buildDraftConfirmBubble(item.draftId, item.amount, item.category, item.merchant)
  );

  return {
    type: 'flex',
    altText: `📝 รายการรอยืนยัน (${items.length} รายการ)`,
    contents: {
      type: 'carousel',
      contents: bubbles,
    },
  };
}
