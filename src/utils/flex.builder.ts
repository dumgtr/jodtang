import { messagingApi } from '@line/bot-sdk';
import { Transaction } from '../types/database';

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

/**
 * Builds a Flex Message Carousel or Bubble for selecting a confirmed transaction to edit or void.
 */
export function buildTxSelectionFlex(
  transactions: Transaction[],
  actionType: 'edit' | 'void'
): messagingApi.FlexMessage {
  const isEdit = actionType === 'edit';
  const headerText = isEdit ? '✏️ เลือกรายการที่ต้องการแก้ไข' : '🗑️ เลือกรายการที่ต้องการลบ';
  const buttonColor = isEdit ? '#1DB446' : '#FF334B';
  const buttonLabel = isEdit ? '✏️ แก้ไขรายการนี้' : '🗑️ ลบรายการนี้';
  const actionPrefix = isEdit ? 'select_tx_for_edit' : 'select_tx_for_void';

  const bubbles: messagingApi.FlexBubble[] = transactions.slice(0, 10).map((tx) => {
    const formattedAmount = Number(tx.amount).toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const dateStr = new Date(tx.occurred_at).toLocaleDateString('th-TH');

    return {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: headerText,
            weight: 'bold',
            color: '#555555',
            size: 'xs',
          },
          {
            type: 'text',
            text: `฿${formattedAmount}`,
            size: 'xl',
            weight: 'bold',
            color: '#111111',
            margin: 'sm',
          },
          {
            type: 'text',
            text: `🏷️ ${tx.category_id || 'ทั่วไป'}`,
            size: 'sm',
            color: '#8C8C8C',
          },
          {
            type: 'text',
            text: `📝 ${tx.description || tx.merchant_id || '-'}`,
            size: 'xs',
            color: '#aaaaaa',
            wrap: true,
            margin: 'xs',
          },
          {
            type: 'text',
            text: `📅 ${dateStr}`,
            size: 'xxs',
            color: '#bbbbbb',
            margin: 'xs',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: buttonColor,
            action: {
              type: 'postback',
              label: buttonLabel,
              data: `action=${actionPrefix}&tx_id=${tx.id}`,
              displayText: buttonLabel,
            },
          },
        ],
      },
    };
  });

  if (bubbles.length === 1) {
    return {
      type: 'flex',
      altText: headerText,
      contents: bubbles[0],
    };
  }

  return {
    type: 'flex',
    altText: headerText,
    contents: {
      type: 'carousel',
      contents: bubbles,
    },
  };
}

/**
 * Builds a Flex Message to confirm voiding a transaction.
 */
export function buildTxVoidConfirmFlex(tx: Transaction): messagingApi.FlexMessage {
  const formattedAmount = Number(tx.amount).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const dateStr = new Date(tx.occurred_at).toLocaleDateString('th-TH');

  return {
    type: 'flex',
    altText: '🗑️ ยืนยันการลบรายการ',
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '⚠️ ต้องการลบรายการนี้ใช่ไหมครับ?',
            weight: 'bold',
            color: '#FF334B',
            size: 'sm',
          },
          {
            type: 'text',
            text: `฿${formattedAmount}`,
            size: 'xxl',
            weight: 'bold',
            color: '#111111',
            margin: 'md',
          },
          {
            type: 'text',
            text: `🏷️ ${tx.category_id || 'ทั่วไป'}`,
            size: 'md',
            color: '#8C8C8C',
          },
          {
            type: 'text',
            text: `📝 ${tx.description || tx.merchant_id || '-'}`,
            size: 'sm',
            color: '#aaaaaa',
            wrap: true,
            margin: 'sm',
          },
          {
            type: 'text',
            text: `📅 วันที่: ${dateStr}`,
            size: 'xs',
            color: '#bbbbbb',
            margin: 'xs',
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
            color: '#FF334B',
            action: {
              type: 'postback',
              label: '❌ ยืนยันการลบ',
              data: `action=confirm_tx_void&tx_id=${tx.id}`,
              displayText: '❌ ยืนยันการลบรายการ',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '↩️ เก็บไว้',
              data: `action=cancel_tx_void&tx_id=${tx.id}`,
              displayText: '↩️ เก็บรายการไว้',
            },
          },
        ],
      },
    },
  };
}

/**
 * Builds a Flex Message previewing proposed edits to a confirmed transaction.
 */
export function buildTxEditConfirmFlex(
  txId: string,
  currentTx: Transaction,
  pendingEdits: Record<string, any>
): messagingApi.FlexMessage {
  const newAmount = pendingEdits.amount !== undefined ? Number(pendingEdits.amount) : Number(currentTx.amount);
  const newCategory = pendingEdits.category_id !== undefined ? pendingEdits.category_id : currentTx.category_id;
  const newDesc = pendingEdits.description !== undefined ? pendingEdits.description : (currentTx.description || currentTx.merchant_id);
  const newDate = pendingEdits.occurred_at ? new Date(pendingEdits.occurred_at) : new Date(currentTx.occurred_at);

  const formattedAmount = newAmount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const dateStr = newDate.toLocaleDateString('th-TH');

  return {
    type: 'flex',
    altText: '✏️ ตรวจสอบการแก้ไขรายการ',
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '✏️ รายการที่แก้ไข (รอตรวจสอบ)',
            weight: 'bold',
            color: '#1DB446',
            size: 'sm',
          },
          {
            type: 'text',
            text: `฿${formattedAmount}`,
            size: 'xxl',
            weight: 'bold',
            color: '#111111',
            margin: 'md',
          },
          {
            type: 'text',
            text: `🏷️ ${newCategory || 'ทั่วไป'}`,
            size: 'md',
            color: '#8C8C8C',
          },
          {
            type: 'text',
            text: `📝 ${newDesc || '-'}`,
            size: 'sm',
            color: '#aaaaaa',
            wrap: true,
            margin: 'sm',
          },
          {
            type: 'text',
            text: `📅 วันที่: ${dateStr}`,
            size: 'xs',
            color: '#bbbbbb',
            margin: 'xs',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#1DB446',
            action: {
              type: 'postback',
              label: '✅ ยืนยันการแก้ไข',
              data: `action=confirm_tx_edit&tx_id=${txId}`,
              displayText: '✅ ยืนยันการแก้ไข',
            },
          },
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              {
                type: 'button',
                style: 'secondary',
                action: {
                  type: 'postback',
                  label: '✏️ แก้ต่อ',
                  data: `action=select_tx_for_edit&tx_id=${txId}`,
                  displayText: '✏️ แก้ไขข้อมูลอื่น',
                },
              },
              {
                type: 'button',
                style: 'secondary',
                color: '#FF334B',
                action: {
                  type: 'postback',
                  label: '❌ ยกเลิก',
                  data: `action=cancel_tx_edit&tx_id=${txId}`,
                  displayText: '❌ ยกเลิกการแก้ไข',
                },
              },
            ],
          },
        ],
      },
    },
  };
}
