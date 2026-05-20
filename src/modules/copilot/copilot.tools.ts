import { LlmTool } from '@common/llm/llm.dto';
import { TransactionCategoryEnum } from '@prisma/client';

// Tools Copilot can call. Keep the surface small — each adds a round-trip
// cost. Every input field is described so the model uses them correctly
// without trial-and-error.
//
// Shape is OpenAI's tool format: `{type: "function", function: {...}}`.
export const COPILOT_TOOLS: LlmTool[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_transactions',
      description:
        "Search the user's transaction history. Use this when the user asks specific questions like 'what did I spend on transport last month' or 'how much did Chowdeck bill me'. Always prefer this over guessing — the snapshot only has aggregates, the ledger has line items.",
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: Object.values(TransactionCategoryEnum),
            description:
              'Filter to a single category. Omit to search across all categories.',
          },
          days: {
            type: 'number',
            description: 'Look back this many days. Default 30.',
          },
          merchant_contains: {
            type: 'string',
            description:
              'Substring to match against the recipient/sender name (case-insensitive). E.g. "chow" matches "Chowdeck".',
          },
          direction: {
            type: 'string',
            enum: ['CREDIT', 'DEBIT'],
            description:
              'Filter to inflows (CREDIT) or outflows (DEBIT). Omit for both.',
          },
          limit: {
            type: 'number',
            description: 'Max rows to return. Default 20. Hard max 100.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'simulate_loan',
      description:
        "Run the loan repayment simulator for the user. Use this when they ask 'can I afford an X loan' or 'what would a Y-day loan cost me'. Returns daily/weekly/total repayment + an affordability flag.",
      parameters: {
        type: 'object',
        properties: {
          productName: {
            type: 'string',
            description:
              "The loan product name from the catalog. If unsure which product, omit and the tool will pick the best match for the user's tier.",
          },
          amountMinor: {
            type: 'number',
            description:
              "Requested amount in the smallest unit of the user's currency (e.g. kobo for NGN, where 100 kobo = ₦1). The snapshot's `currency` block tells you the unit in play.",
          },
          tenorDays: {
            type: 'number',
            description: 'Loan tenor in days.',
          },
        },
        required: ['amountMinor', 'tenorDays'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'simulate_investment',
      description:
        "Project the return of placing an amount into an investment product. Use this when the user asks 'how much would I make if I put X into Y'. Returns the projected interest at maturity (or annualised, for open-ended products).",
      parameters: {
        type: 'object',
        properties: {
          productName: {
            type: 'string',
            description:
              "The investment product name from the catalog. If omitted, picks the highest-yield product the user could fund.",
          },
          amountMinor: {
            type: 'number',
            description:
              "Amount to allocate, in the smallest unit of the user's currency (e.g. kobo for NGN). The snapshot's `currency` block tells you the unit in play.",
          },
        },
        required: ['amountMinor'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pocket_balances',
      description:
        "Read the user's wallet pockets (Spend / Save / Goals / custom). Use this when they ask 'how much is in Save' or 'how much could I move from Spend'.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_top_recommendations',
      description:
        "Return the top 3 active recommendation candidates for the user (Save / Spend / Grow / Earn). Use this when the user asks 'what should I do' or 'what's your advice'.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];
