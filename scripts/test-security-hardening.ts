import assert from 'node:assert/strict';
import {
  GENERIC_USER_ERROR_MESSAGE,
  getInternalErrorDetails,
  getSafeHttpStatus,
} from '../src/utils/errors';

type Reply = {
  replyToken: string;
  messages: Array<{ type: string; text?: string }>;
};

const testUser = {
  id: '00000000-0000-0000-0000-000000000001',
  line_user_id: 'U_SECURITY_TEST_USER',
  created_at: new Date(),
};

function createLineClient(replies: Reply[]) {
  return {
    replyMessage: async (reply: Reply) => {
      replies.push(reply);
    },
  } as any;
}

function replyTexts(replies: Reply[]): string[] {
  return replies.flatMap((reply) => reply.messages.map((message) => message.text || ''));
}

async function testSafeErrorResponses(): Promise<void> {
  // Make the provider path deterministic without reading or printing a real key.
  process.env.OPENAI_API_KEY = 'provider-test-key';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1';

  const [{ UserRepository }, { DraftRepository }, { TransactionRepository }, { handleTextMessage }, { handlePostbackEvent }] =
    await Promise.all([
      import('../src/modules/user/user.repository'),
      import('../src/modules/draft/draft.repository'),
      import('../src/modules/transaction/transaction.repository'),
      import('../src/handlers/message.handler'),
      import('../src/handlers/postback.handler'),
      import('../src/services/ai.service'),
    ]);

  const originalFindOrCreate = UserRepository.findOrCreateByLineUserId;
  const originalCreateDraft = DraftRepository.createDraft;
  const originalCommitDraft = TransactionRepository.commitDraft;
  const originalFetch = globalThis.fetch;

  try {
    const databaseErrorReplies: Reply[] = [];
    UserRepository.findOrCreateByLineUserId = async () => {
      throw new Error('DB_INTERNAL_TABLE_OR_CONNECTION_DETAIL');
    };
    await handleTextMessage(
      testUser.line_user_id,
      'ข้าว 80',
      'reply-database-error',
      createLineClient(databaseErrorReplies)
    );
    assert.deepEqual(replyTexts(databaseErrorReplies), [GENERIC_USER_ERROR_MESSAGE]);
    assert(!replyTexts(databaseErrorReplies).some((text) => text.includes('DB_INTERNAL_TABLE')));

    const providerErrorReplies: Reply[] = [];
    UserRepository.findOrCreateByLineUserId = async () => testUser;
    DraftRepository.createDraft = async () => ({
      id: '00000000-0000-0000-0000-000000000002',
      user_id: testUser.id,
      source: 'test',
      raw_input: 'ข้าว 80',
      extracted_data: {
        type: 'expense',
        amount: 80,
        category_id: 'อาหารและเครื่องดื่ม',
        merchant_id: 'ข้าว',
        description: 'ข้าว 80',
      },
      status: 'pending_confirmation',
      expires_at: new Date(Date.now() + 60_000),
      created_at: new Date(),
    });
    globalThis.fetch = (async () => {
      throw new Error('PROVIDER_INTERNAL_RESPONSE_DETAIL');
    }) as typeof fetch;
    await handleTextMessage(
      testUser.line_user_id,
      'ข้าว 80',
      'reply-provider-error',
      createLineClient(providerErrorReplies)
    );
    const providerReplyPayload = JSON.stringify(providerErrorReplies);
    assert(providerErrorReplies.length > 0, 'provider fallback should still produce a user response');
    assert(!providerReplyPayload.includes('PROVIDER_INTERNAL_RESPONSE_DETAIL'));

    const postbackErrorReplies: Reply[] = [];
    TransactionRepository.commitDraft = async () => {
      throw new Error('TRANSACTION_INTERNAL_DATABASE_DETAIL');
    };
    await handlePostbackEvent(
      testUser,
      'action=confirm&draft_id=00000000-0000-0000-0000-000000000002',
      'reply-postback-error',
      createLineClient(postbackErrorReplies)
    );
    assert.deepEqual(replyTexts(postbackErrorReplies), [GENERIC_USER_ERROR_MESSAGE]);
    assert(!replyTexts(postbackErrorReplies).some((text) => text.includes('TRANSACTION_INTERNAL')));
  } finally {
    UserRepository.findOrCreateByLineUserId = originalFindOrCreate;
    DraftRepository.createDraft = originalCreateDraft;
    TransactionRepository.commitDraft = originalCommitDraft;
    globalThis.fetch = originalFetch;
  }
}

function testErrorUtilities(): void {
  assert.equal(getSafeHttpStatus({ statusCode: 401 }), 401);
  assert.equal(getSafeHttpStatus({ status: 422 }), 422);
  assert.equal(getSafeHttpStatus(new Error('unexpected')), 500);

  const details = getInternalErrorDetails(
    new Error('postgresql://user:password@example.test/db authorization: secret-value')
  );
  assert(!details.message.includes('password@example.test'));
  assert(!details.message.includes('secret-value'));
}

async function main(): Promise<void> {
  testErrorUtilities();
  await testSafeErrorResponses();
  console.log('Security error-handling regression tests passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
