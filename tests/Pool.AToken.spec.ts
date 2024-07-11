import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { address, toNano, beginCell, Address, Cell } from '@ton/core';
import { ATokenDTokenContents, Pool, ReserveConfiguration } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { AToken } from '../wrappers/AToken';
import { ATokenDefaultWallet } from '../build/AToken/tact_ATokenDefaultWallet';

describe('Pool', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let aToken: SandboxContract<AToken>;

    const reserveAddress = address('UQAEJ7U1iaC1TzcFel5lc2-JaEm8I0k5Krui3fzz3_GeANWV');
    const aTokenJettonParams = {
        name: 'SampleJetton AToken',
        description: 'Sample Jetton aToken',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'aSAM',
    };
    let aTokenContent = buildOnchainMetadata(aTokenJettonParams);
    const contents: ATokenDTokenContents = {
        $$type: 'ATokenDTokenContents',
        aTokenContent,
        dTokenContent: Cell.EMPTY, // TODO
    };

    const reserveConfiguration: ReserveConfiguration = {
        $$type: 'ReserveConfiguration',
        poolWalletAddress: reserveAddress,
        aTokenAddress: reserveAddress,
        dTokenAddress: reserveAddress,
        ltv: 6000n,
        liquidationThreshold: 750n,
        liquidationBonus: 500n,
        reserveFactor: 1000n,
        liquidationProtocolFee: 50n,
        optimalUsageRatio: 7000n,
        slope1: 1000n,
        slope2: 3000n,
        borrowingEnabled: true,
        supplyCap: 1000000n,
        borrowCap: 1000000n,
    };

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        pool = blockchain.openContract(await Pool.fromInit());

        deployer = await blockchain.treasury('deployer');
        secondUser = (await blockchain.createWallets(2))[1];

        const deployResult = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            deploy: true,
            success: true,
        });

        const result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'AddReserve',
                reserveAddress,
                reserveConfiguration,
                contents,
            },
        );

        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        const calculateATokenAddress = await pool.getCalculateATokenAddress(contents.aTokenContent, reserveAddress);

        // TODO: the aToken calculated from Atoken.fromInit and pool.getCalculateATokenAddress is different!!! why?
        // const aToken = blockchain.openContract(await AToken.fromInit(pool.address, contents.aTokenContent, reserveAddress))
        aToken = blockchain.openContract(AToken.fromAddress(calculateATokenAddress));
        expect((await aToken.getOwner()).toString()).toEqual(pool.address.toString());
        expect((await aToken.getGetPoolData()).pool.toString()).toEqual(pool.address.toString());
        expect((await aToken.getGetPoolData()).asset.toString()).toEqual(reserveAddress.toString());

        const reserveConfigurationResult = await pool.getReserveConfiguration(reserveAddress);
        expect(reserveConfigurationResult.aTokenAddress.toString()).toEqual(aToken.address.toString());
    });

    it('AToken transfer', async () => {
        let rst = await aToken.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'Mint',
                receiver: deployer.getSender().address,
                amount: toNano('1000'),
            },
        );
        expect(rst.transactions).toHaveTransaction({
            from: deployer.address,
            to: aToken.address,
            success: true,
        });
        const userWallet = blockchain.openContract(
            ATokenDefaultWallet.fromAddress(await aToken.getGetWalletAddress(deployer.getSender().address)),
        );
        console.log(`userWallet`, userWallet.address.toString());
        const walletData = await userWallet.getGetWalletData();
        expect(walletData.balance).toEqual(toNano('1000'));
        expect(walletData.master.toString()).toEqual(aToken.address.toString());

        const secondUserWallet = blockchain.openContract(
            ATokenDefaultWallet.fromAddress(await aToken.getGetWalletAddress(secondUser.address)),
        );
        console.log(`secondUserWallet`, secondUserWallet.address.toString());

        rst = await userWallet.send(
            deployer.getSender(),
            {
                value: toNano('0.5'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 1n,
                amount: toNano(100),
                destination: secondUser.address,
                response_destination: deployer.getSender().address!!,
                custom_payload: null,
                forward_ton_amount: toNano('0.1'),
                forward_payload: Cell.EMPTY,
            },
        );
        expect(rst.transactions).toHaveTransaction({
            from: deployer.address,
            to: userWallet.address,
            success: true,
        });
        expect(rst.transactions).toHaveTransaction({
            from: userWallet.address,
            to: pool.address,
            success: true,
        });
        expect(rst.transactions).toHaveTransaction({
            from: pool.address,
            to: userWallet.address,
            success: true,
        });
        expect(rst.transactions).toHaveTransaction({
            from: userWallet.address,
            to: secondUserWallet.address,
            success: true,
        });
        const secondUserWalletData = await secondUserWallet.getGetWalletData();
        expect(secondUserWalletData.balance).toEqual(toNano('100'));
        expect(secondUserWalletData.master.toString()).toEqual(aToken.address.toString());
    });
});
