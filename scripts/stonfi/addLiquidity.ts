import { mnemonicToWalletKey } from '@ton/crypto';
import { NetworkProvider } from '@ton/blueprint';
import { toNano, Address, WalletContractV4, internal } from '@ton/ton';
import { DEX } from '@ston-fi/sdk';
import { TESTNET_ADDRESS } from '../../helpers/constant';
import { SampleJetton } from '../../wrappers/SampleJetton';

export async function run(provider: NetworkProvider) {
    const keyPair = await mnemonicToWalletKey(process.env.WALLET_MNEMONIC?.split(',') || []);
    const workchain = 0;
    const wallet = WalletContractV4.create({
        workchain,
        publicKey: keyPair.publicKey,
    });
    const userWalletContract = provider.open(wallet);
    const userWalletAddress = wallet.address.toString();

    const notcoin = provider.open(
        SampleJetton.fromAddress(Address.parse('kQD8-IT-fOEuBqY5bG_NY3lcZTKnnKv-7_UuILidV2eCaz40')),
    );
    const mas = provider.open(
        SampleJetton.fromAddress(Address.parse('kQBe9prUeNqHJHRw4YWDZhXI91kiGaGTTHuCWIaY975Uw9ue')),
    );

    const router = provider.open(new DEX.v1.Router(TESTNET_ADDRESS.STONFI_V1_ROUTER));
    const routerNotCoinWalletAddress = await notcoin.getGetWalletAddress(router.address);
    const routerMasWalletAddress = await notcoin.getGetWalletAddress(router.address);

    // Lp contract
    const pool = provider.open(
        await router.getPool({
            token0: mas.address,
            token1: notcoin.address,
        }),
    );
    const { reserve0, reserve1, token0WalletAddress, token1WalletAddress } = await pool.getPoolData();

    // user's Lp Jetton wallet
    const userLpWallet = provider.open(
        await pool.getJettonWallet({
            ownerAddress: userWalletAddress,
        }),
    );

    // user lp balance
    const userLpBalance = (await userLpWallet.getWalletData()).balance;
    console.log(userLpBalance);

    // your Lp === `amount0` token0 + `amount1` token1
    const { amount0, amount1 } = await pool.getExpectedLiquidity({
        jettonAmount: userLpBalance,
    });
    console.log(`amount0: ${amount0}`);
    console.log(`amount1: ${amount1}`);

    const notcoinAmount = toNano(10);
    const expectedMasAmount =
        routerNotCoinWalletAddress.toString() === token0WalletAddress.toString()
            ? (reserve0 * notcoinAmount) / reserve1
            : (reserve1 * notcoinAmount) / reserve0;

    const txsParams = await Promise.all([
        router.getProvideLiquidityJettonTxParams({
            userWalletAddress: userWalletAddress,
            sendTokenAddress: notcoin.address,
            sendAmount: notcoinAmount,
            otherTokenAddress: mas.address,
            minLpOut: '1',
            queryId: 12345,
        }),
        router.getProvideLiquidityJettonTxParams({
            userWalletAddress: userWalletAddress,
            sendTokenAddress: mas.address,
            sendAmount: expectedMasAmount,
            otherTokenAddress: notcoin.address,
            minLpOut: '1',
            queryId: 123456,
        }),
    ]);

    await userWalletContract.sendTransfer({
        seqno: await userWalletContract.getSeqno(),
        secretKey: keyPair.secretKey,
        messages: txsParams.map((tx) => internal(tx)),
    });
}
