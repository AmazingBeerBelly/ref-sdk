import {
  TokenMetadata,
  EstimateSwapView,
  Transaction,
  RefFiFunctionCallOptions,
} from './types';
import { wallet, ftGetStorageBalance } from './ref';
import {
  STORAGE_TO_REGISTER_WITH_MFT,
  REF_FI_CONTRACT_ID,
  ONE_YOCTO_NEAR,
} from './constant';
import { round, percentLess } from './utils';
import { toNonDivisibleNumber } from './number';
import { config } from './constant';
import { NotLoginError } from './error';

export const instantSwap = async ({
  tokenIn,
  tokenOut,
  amountIn,
  slippageTolerance,
  swapTodos,
}: {
  tokenIn: TokenMetadata;
  tokenOut: TokenMetadata;
  amountIn: string;
  slippageTolerance: number;
  swapTodos: EstimateSwapView[];
}) => {
  const transactions: Transaction[] = [];

  if (!!wallet.isSignedIn()) return NotLoginError;

  const registerToken = async (token: TokenMetadata) => {
    const tokenRegistered = await ftGetStorageBalance(token.id).catch(() => {
      throw new Error(`${token.id} doesn't exist.`);
    });

    if (tokenRegistered === null) {
      transactions.push({
        receiverId: token.id,
        functionCalls: [
          {
            methodName: 'storage_deposit',
            args: {
              registration_only: true,
              account_id: wallet.getAccountId(),
            },
            gas: '30000000000000',
            amount: STORAGE_TO_REGISTER_WITH_MFT,
          },
        ],
      });
    }
  };

  await registerToken(tokenOut);
  let actionsList = [];
  let allSwapsTokens = swapTodos.map(s => [s.inputToken, s.outputToken]); // to get the hop tokens
  for (let i in allSwapsTokens) {
    let swapTokens = allSwapsTokens[i];
    if (swapTokens[0] == tokenIn.id && swapTokens[1] == tokenOut.id) {
      // parallel, direct hop route.
      actionsList.push({
        pool_id: swapTodos[i].pool.id,
        token_in: tokenIn.id,
        token_out: tokenOut.id,
        amount_in: swapTodos[i].pool.partialAmountIn,
        min_amount_out: round(
          tokenOut.decimals,
          toNonDivisibleNumber(
            tokenOut.decimals,
            percentLess(slippageTolerance, swapTodos[i].estimate)
          )
        ),
      });
    } else if (swapTokens[0] == tokenIn.id) {
      // first hop in double hop route
      //TODO -- put in a check to make sure this first hop matches with the next (i+1) hop as a second hop.
      actionsList.push({
        pool_id: swapTodos[i].pool.id,
        token_in: swapTokens[0],
        token_out: swapTokens[1],
        amount_in: swapTodos[i].pool.partialAmountIn,
        min_amount_out: '0',
      });
    } else {
      // second hop in double hop route.
      //TODO -- put in a check to make sure this second hop matches with the previous (i-1) hop as a first hop.
      actionsList.push({
        pool_id: swapTodos[i].pool.id,
        token_in: swapTokens[0],
        token_out: swapTokens[1],
        min_amount_out: round(
          tokenOut.decimals,
          toNonDivisibleNumber(
            tokenOut.decimals,
            percentLess(slippageTolerance, swapTodos[i].estimate)
          )
        ),
      });
    }
  }

  transactions.push({
    receiverId: tokenIn.id,
    functionCalls: [
      {
        methodName: 'ft_transfer_call',
        args: {
          receiver_id: REF_FI_CONTRACT_ID,
          amount: toNonDivisibleNumber(tokenIn.decimals, amountIn),
          msg: JSON.stringify({
            force: 0,
            actions: actionsList,
          }),
        },
        gas: '180000000000000',
        amount: ONE_YOCTO_NEAR,
      },
    ],
  });

  if (tokenIn.id === config.WRAP_NEAR_CONTRACT_ID) {
    const registered = await ftGetStorageBalance(config.WRAP_NEAR_CONTRACT_ID);
    if (registered === null) {
      registerToken(tokenIn);
    }
  }

  return transactions;
};
