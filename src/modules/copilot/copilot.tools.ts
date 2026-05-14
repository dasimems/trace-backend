import { AnthropicTool } from '@common/anthropic/anthropic.dto';
import { TransactionCategoryEnum } from '@prisma/client';

// Tools Copilot can call. Keep the surface small — each adds a Claude
// round-trip cost. Every input field is described so the model uses them
// correctly without trial-and-error.
export const COPILOT_TOOLS: AnthropicTool[] = [
  {
    name: 'lookup_transactions',
    description:
      "Search the user's transaction history. Use this when the user asks specific questions like 'what did I spend on transport last month' or 'how much did Chowdeck bill me'. Always prefer this over guessing — the snapshot only has aggregates, the ledger has line items.",
    input_schema: {
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
  {
    name: 'simulate_loan',
    description:
      "Run the loan repayment simulator for the user. Use this when they ask 'can I afford an X loan' or 'what would a Y-day loan cost me'. Returns daily/weekly/total repayment + an affordability flag.",
    input_schema: {
      type: 'object',
      properties: {
        productName: {
          type: 'string',
          description:
            "The loan product name from the catalog. If unsure which product, omit and the tool will pick the best match for the user's tier.",
        },
        amountKobo: {
          type: 'number',
          description: 'Requested amount in kobo (100 kobo = ₦1).',
        },
        tenorDays: {
          type: 'number',
          description: 'Loan tenor in days.',
        },
      },
      required: ['amountKobo', 'tenorDays'],
    },
  },
  {
    name: 'simulate_investment',
    description:
      "Project the return of placing an amount into an investment product. Use this when the user asks 'how much would I make if I put X into Y'. Returns the projected interest at maturity (or annualised, for open-ended products).",
    input_schema: {
      type: 'object',
      properties: {
        productName: {
          type: 'string',
          description:
            "The investment product name from the catalog. If omitted, picks the highest-yield product the user could fund.",
        },
        amountKobo: {
          type: 'number',
          description: 'Amount to allocate, in kobo.',
        },
      },
      required: ['amountKobo'],
    },
  },
  {
    name: 'get_pocket_balances',
    description:
      "Read the user's wallet pockets (Spend / Save / Goals / custom). Use this when they ask 'how much is in Save' or 'how much could I move from Spend'.",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_top_recommendations',
    description:
      "Return the top 3 active recommendation candidates for the user (Save / Spend / Grow / Earn). Use this when the user asks 'what should I do' or 'what's your advice'.",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];
