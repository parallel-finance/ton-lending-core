import { NetworkProvider } from '@ton/blueprint';
import { toNano, Address } from '@ton/ton';
import { DEX, pTON } from '@ston-fi/sdk';
import { MAINNET_ADDRESS } from '../../helpers/constant';

export async function run(provider: NetworkProvider) {
    const userWalletAddress = provider.sender().address!!;

    const usdt = Address.parse(MAINNET_ADDRESS.USDT);
    const pTon = new pTON.v1().address;

    const router = provider.open(new DEX.v1.Router(MAINNET_ADDRESS.STONFI_V1_ROUTER));

    // Pool contract / Lp token
    const pool = provider.open(
        await router.getPool({
            token0: usdt,
            token1: pTon,
        }),
    );
    console.log(`LP Token / Pool address: ${pool.address.toString()}`);

    // user's Lp Jetton wallet
    const userLpWallet = provider.open(
        await pool.getJettonWallet({
            ownerAddress: userWalletAddress,
        }),
    );

    // user lp balance
    const userLpBalance = (await userLpWallet.getWalletData()).balance;
    // const userLpBalance = await userLpWallet.getBalance()
    console.log(userLpBalance, await userLpWallet.getBalance());

    // Lp data
    const { reserve0, reserve1, token0WalletAddress, token1WalletAddress } = await pool.getPoolData();
    console.log(`reserve0: ${reserve0}`);
    console.log(`reserve1: ${reserve1}`);
    console.log(`token0WalletAddress: ${token0WalletAddress.toString()}`); // router's jetton wallet address of USDT
    console.log(`token1WalletAddress: ${token1WalletAddress.toString()}`); // router's jetton wallet address of pTON

    // your Lp === `amount0` token0 + `amount1` token1
    const { amount0, amount1 } = await pool.getExpectedLiquidity({
        jettonAmount: userLpBalance,
    });
    console.log(`amount0: ${amount0}`);
    console.log(`amount1: ${amount1}`);

    // Estimate an expected amount of lp tokens minted when providing liquidity.
    const expectedLpAmount = await pool.getExpectedTokens({
        amount0: toNano(100),
        amount1: toNano(100),
    });
    console.log(`expected lp amount: ${expectedLpAmount}`);

    const token1Amount = toNano(100);
    const expectedToken0Amount = (reserve0 * token1Amount) / reserve1;
    console.log(`expected Token0 Amount:`, expectedToken0Amount);

    const token0Amount = toNano(100);
    const expectedToken1Amount = (reserve1 * token0Amount) / reserve0;
    console.log(`expected Token1 Amount:`, expectedToken1Amount);

    // user Lp Account instance
    const userLpAccount = provider.open(
        await pool.getLpAccount({
            ownerAddress: userWalletAddress,
        }),
    );

    // user Lp Account address === userLpAccount.address
    const userLpAccountAddress = await pool.getLpAccountAddress({
        ownerAddress: userWalletAddress,
    });

    // Lp account info: {amount0, amount1}
    // amount0/amount1 is the token0/token1 amount user transferred in the message flow of `add liquidity`
    // amount0/amount1 will be set to zero at the end of `add liquidity` message flow.
    const userLpData = await userLpAccount.getLpAccountData();

    console.log(`userLpData`, userLpData);
}
