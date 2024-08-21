import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { ClaimHelper } from '../wrappers/ClaimHelper';
import { JettonVault } from '../wrappers/JettonVault';
import { RewardJettonMaster } from '../wrappers/RewardJettonMaster';
import { compile } from '@ton/blueprint';
import { JettonWallet } from '../wrappers/JettonWallet';
import { sumTransactionsFee } from '../jest.setup';

describe('ClaimRewards', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let usdt: SandboxContract<SampleJetton>;

    // FunC implemented jetton contract
    let usdtRewardJettonMasterCode: Cell;
    let usdtRewardJettonWalletCode: Cell;
    let usdtRewardJettonMaster: SandboxContract<RewardJettonMaster>;
    let usdtRewardJettonWallet: SandboxContract<JettonWallet>;

    let jettonVault: SandboxContract<JettonVault>;
    let usdtClaimHelper: SandboxContract<ClaimHelper>;
    let constructJettonWalletConfig: any;
    let constructRewardJettonMasterConfig;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        const jettonParams = {
            name: 'USDT-Jetton',
            description: 'Sample USDT Jetton for testing purposes',
            decimals: '6',
            image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
            symbol: 'USDT',
        };
        const usdtRewardJettonParams = {
            ...jettonParams,
            name: 'USDT-Reward-Jetton',
            symbol: "T-USDT",
        }

        // It's the largest value I can use for max_supply in the tests
        let max_supply = (1n << 120n) - 1n;
        // let max_supply = toNano(1000000n); // 🔴 Set the specific total supply in nano
        let content = buildOnchainMetadata(jettonParams);
        let usdtRewardJettonContent = buildOnchainMetadata(usdtRewardJettonParams);

        usdt = blockchain.openContract(await SampleJetton.fromInit(deployer.address, content, max_supply));

        // usdtRewardJetton = blockchain.openContract(await RewardJettonMaster.fromInit(deployer.address, usdtRewardJettonContent, max_supply));
        // const deployUsdtRewardJetton = await usdtRewardJetton.send(
        //     deployer.getSender(),
        //     {
        //         value: toNano('0.05'),
        //     },
        //     {
        //         $$type: 'Deploy',
        //         queryId: 0n,
        //     },
        // );
        usdtRewardJettonWalletCode = await compile('JettonWallet');
        usdtRewardJettonMasterCode = await compile('RewardJettonMaster');

        constructRewardJettonMasterConfig = (ownerAddress: any) =>
            blockchain.openContract(RewardJettonMaster.createFromConfig(
                {
                    admin: ownerAddress,
                    content: usdtRewardJettonContent,
                    walletCode: usdtRewardJettonWalletCode,
                },
                usdtRewardJettonMasterCode
            ));

        constructJettonWalletConfig = (ownerAddress: any, jetton: any = JettonWallet) =>
            blockchain.openContract(
                jetton.createFromConfig(
                    {
                        owner: ownerAddress,
                        minter: usdtRewardJettonMaster.address,
                        walletCode: usdtRewardJettonWalletCode,
                    },
                    usdtRewardJettonWalletCode
                ));

        usdtRewardJettonMaster = constructRewardJettonMasterConfig(deployer.address)
        usdtRewardJettonWallet = constructJettonWalletConfig(deployer.address)

        jettonVault = blockchain.openContract(await JettonVault.fromInit());
        const deployResult = await usdt.send(
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
            to: usdt.address,
            deploy: true,
            success: true,
        });

        const deployUsdtRewardJetton = await usdtRewardJettonMaster.sendDeploy(
            deployer.getSender(),
            toNano('0.05'),
        );

        expect(deployUsdtRewardJetton.transactions).toHaveTransaction({
            from: deployer.address,
            to: usdtRewardJettonMaster.address,
            deploy: true,
            success: true,
        })
        const deployJettonVault = await jettonVault.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );
        expect(deployJettonVault.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonVault.address,
            deploy: true,
            success: true,
        })
        const jettonVaultUsdtWalletAddress = await usdt.getGetWalletAddress(jettonVault.address);
        await jettonVault.send(
            deployer.getSender(),
            {
                value: toNano("0.05"),
            },
            {

                $$type: 'ResetJettonWalletAddress',
                newAddress: jettonVaultUsdtWalletAddress,
            },
        )


        usdtClaimHelper = blockchain.openContract(await ClaimHelper.fromInit(usdtRewardJettonMaster.address, jettonVault.address));
        const deployUsdtClaimHelper = await usdtClaimHelper.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        )
        expect(deployUsdtClaimHelper.transactions).toHaveTransaction({
            from: deployer.address,
            to: usdtClaimHelper.address,
            deploy: true,
            success: true,
        })
        const usdtClaimHelperUsdtRewardJettonWalletAddress = await usdtRewardJettonMaster.getWalletAddress(usdtClaimHelper.address);
        await usdtClaimHelper.send(
            deployer.getSender(),
            {
                value: toNano("0.05"),
            },
            {

                $$type: 'ResetJettonWalletAddress',
                newAddress: usdtClaimHelperUsdtRewardJettonWalletAddress,
            },
        )

        const setUsdtClaimable = await jettonVault.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'ConfigureJettonMapping',
                originJettonAddress: usdtRewardJettonMaster.address,
                claimableJettonAddress: jettonVaultUsdtWalletAddress,
                claimHelper: usdtClaimHelper.address,
            },
        );
        expect(setUsdtClaimable.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonVault.address,
            success: true,
        });

        // const mapping = await jettonVault.getAllClaimableJettonMapping();
        // console.log(mapping);
    });

    describe('claim USDT rewards', () => {
        it('should claim USDT successfully', async () => {
            // const receiverAddress = (await blockchain.createWallets(1))[0].address;
            await usdt.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'Mint',
                    queryId: 0n,
                    amount: toNano("1"),
                    receiver: jettonVault.address,
                },
            );

            // await usdtRewardJetton.send(
            //     deployer.getSender(),
            //     {
            //         value: toNano('0.05'),
            //     },
            //     {
            //         $$type: 'Mint',
            //         queryId: 0n,
            //         amount: toNano(1),
            //         receiver: senderAddress,
            //     },
            // );
            const sender = deployer.getSender();
            const senderAddress = sender.address;
            const mintAmount = toNano("1")
            const mintUsdtRewardJettonResult = await usdtRewardJettonMaster.sendMint(
                sender,
                senderAddress,
                mintAmount,
                toNano('0.05'),
                toNano('0.06'),
            );
            expect(mintUsdtRewardJettonResult.transactions).toHaveTransaction({
                from: undefined,
                oldStatus: "active",
                endStatus: "active",
                success: true,
            });

            const jettonVaultUsdtRewardJettonWalletAddress = await usdtRewardJettonMaster.getWalletAddress(jettonVault.address);
            const senderUsdtRewardJettonWalletAddress = await usdtRewardJettonMaster.getWalletAddress(senderAddress);
            const usdtClaimHelperUsdtRewardJettonWalletAddress = await usdtRewardJettonMaster.getWalletAddress(usdtClaimHelper.address);
            const jettonVaultUsdtWalletAddress = await usdt.getGetWalletAddress(jettonVault.address);
            const senderUsdtWalletAddress = await usdt.getGetWalletAddress(senderAddress);
            const usdtClaimHelperWalletAddress = await usdt.getGetWalletAddress(usdtClaimHelper.address);

            const jettonVaultUsdtRewardJettonWallet = constructJettonWalletConfig(jettonVault.address)
            const usdtClaimHelperUsdtRewardJettonWallet = constructJettonWalletConfig(usdtClaimHelper.address)
            const senderUsdtRewardJettonWallet = constructJettonWalletConfig(senderAddress)

            const jettonVaultUsdtWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(jettonVaultUsdtWalletAddress));
            const senderUsdtWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(senderUsdtWalletAddress));
            const usdtClaimHelperWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(usdtClaimHelperWalletAddress));

            const senderUsdtRewardJettonWalletBalanceBefore = await senderUsdtRewardJettonWallet.getJettonBalance();
            const usdtClaimHelperUsdtRewardJettonWalletBalanceBefore = await usdtClaimHelperUsdtRewardJettonWallet.getJettonBalance();
            const jettonVaultUsdtRewardJettonWalletBalanceBefore = await jettonVaultUsdtRewardJettonWallet.getJettonBalance();
            // let senderUsdtWalletBalanceBefore = 0, usdtClaimHelperWalletBalanceBefore = 0, jettonVaultUsdtWalletBalanceBefore = 0;
            // const senderUsdtWalletBalanceBefore = (await senderUsdtWallet.getGetWalletData()).balance;
            // const usdtClaimHelperWalletBalanceBefore = (await usdtClaimHelperWallet.getGetWalletData()).balance;
            const jettonVaultUsdtWalletBalanceBefore = (await jettonVaultUsdtWallet.getGetWalletData()).balance;

            const claimAmount = toNano("0.3");
            const claimUsdtRewardResult = await usdtRewardJettonWallet.sendTransfer(
                sender,
                toNano('0.35'),
                toNano('0.35'),
                usdtClaimHelper.address,
                claimAmount,
                beginCell().storeUint(0x7994ff68, 32).endCell(), // opcode: ClaimReward
            );

            // console.log({
            //     senderAddress: deployer.getSender().address.toString(),
            //     usdt: usdt.address.toString(),
            //     usdtRewardJettonMaster: usdtRewardJettonMaster.address.toString(),
            //     usdtClaimHelper: usdtClaimHelper.address.toString(),
            //     jettonVault: jettonVault.address.toString(),
            //     jettonVaultUsdtRewardJettonWalletAddress: jettonVaultUsdtRewardJettonWalletAddress.toString(),
            //     senderUsdtRewardJettonWalletAddress: senderUsdtRewardJettonWalletAddress.toString(),
            //     usdtClaimHelperUsdtRewardJettonWalletAddress: usdtClaimHelperUsdtRewardJettonWallet.address.toString(),
            //     jettonVaultUsdtWalletAddress: jettonVaultUsdtWalletAddress.toString(),
            //     senderUsdtWalletAddress: senderUsdtWalletAddress.toString(),
            //     usdtClaimHelperWalletAddress: usdtClaimHelperWalletAddress.toString(),
            // })

            // senderAddress: 'EQBGhqLAZseEqRXz4ByFPTGV7SVMlI4hrbs-Sps_Xzx01x8G',
            // usdt: 'EQCLXahLiLxTBrl2nqtkC-XuYS-NMQBn0Lorqenu7Ro-WHgh',
            // usdtRewardJettonMaster: 'EQB9bNGR1Oq-H7o3I2QuDcRFqPArz8iOP4Frw85nnpO8O_Ut',
            // usdtClaimHelper: 'EQBRoMCuKrGmsQVMjiSLE_4FuAxQc_ma59MQwUjwwSNmAzz2',
            // jettonVault: 'EQBFCcgN9vjvGkHHbsF5K2a_ISUJ0ivwWte0JhtN9uxKALxH',
            // jettonVaultUsdtRewardJettonWalletAddress: 'EQCeXuFHt9P8oD2naWyIsMrwTlaVYqcyT-6FLI3Jtndu70fp',
            // senderUsdtRewardJettonWalletAddress: 'EQClxuVYg2sIzsZKhtQ2JzduYFmamsjn80MzM9Y8a6qCmdDH',
            // usdtClaimHelperUsdtRewardJettonWalletAddress: 'EQB2FoacPJaE-2z024MV_5n46qki04VZ_fRU1cJprQ1JaKxl'

            // external message
            expect(claimUsdtRewardResult.transactions).toHaveTransaction({
                from: undefined,
                to: senderAddress,
                outMessagesCount: 1,
                success: true,
            });
            // op::transfer message
            expect(claimUsdtRewardResult.transactions).toHaveTransaction({
                from: senderAddress,
                to: senderUsdtRewardJettonWalletAddress,
                outMessagesCount: 1,
                success: true,
            });
            // op::internal_transfer message
            expect(claimUsdtRewardResult.transactions).toHaveTransaction({
                from: senderUsdtRewardJettonWalletAddress,
                to: usdtClaimHelperUsdtRewardJettonWalletAddress,
                outMessagesCount: 2,
                oldStatus: "uninitialized",
                endStatus: "active",
                success: true,
            });
            // op::transfer_notification message
            expect(claimUsdtRewardResult.transactions).toHaveTransaction({
                from: usdtClaimHelperUsdtRewardJettonWalletAddress,
                to: usdtClaimHelper.address,
                outMessagesCount: 1,
                success: true,
            });
            // op::excesses message
            expect(claimUsdtRewardResult.transactions).toHaveTransaction({
                from: usdtClaimHelperUsdtRewardJettonWalletAddress,
                to: senderAddress,
                outMessagesCount: 0,
                success: true,
            })
            // ClaimReward message
            expect(claimUsdtRewardResult.transactions).toHaveTransaction({
                from: usdtClaimHelper.address,
                to: jettonVault.address,
                outMessagesCount: 1,
                success: true,
            })
            // TokenTransfer message
            expect(claimUsdtRewardResult.transactions).toHaveTransaction({
                from: usdtClaimHelper.address,
                to: jettonVault.address,
                outMessagesCount: 1,
                success: true,
            })

            // TokenTransfer message
            expect(claimUsdtRewardResult.transactions).toHaveTransaction({
                // from: usdtClaimHelper.address,
                // to: jettonVault.address,
                outMessagesCount: 1,
                success: true,
            })
            // op::internal_transfer message
            expect(claimUsdtRewardResult.transactions).toHaveTransaction({
                from: usdtClaimHelper.address,
                to: jettonVault.address,
                outMessagesCount: 1,
                success: true,
            })
            // op::transfer_notification message
            expect(claimUsdtRewardResult.transactions).toHaveTransaction({
                from: senderUsdtWalletAddress,
                to: senderAddress,
                outMessagesCount: 0,
                success: true,
            })

            const jettonVaultUsdtRewardJettonWalletBalance = await jettonVaultUsdtRewardJettonWallet.getJettonBalance();
            const usdtClaimHelperUsdtRewardJettonWalletBalance = await usdtClaimHelperUsdtRewardJettonWallet.getJettonBalance();
            const senderUsdtRewardJettonWalletBalance = await senderUsdtRewardJettonWallet.getJettonBalance();

            const senderUsdtWalletBalance = (await senderUsdtWallet.getGetWalletData()).balance;
            // const usdtClaimHelperWalletBalance = (await usdtClaimHelperWallet.getGetWalletData()).balance;
            const jettonVaultUsdtWalletBalance = (await jettonVaultUsdtWallet.getGetWalletData()).balance;

            console.table([
                {
                    "JettonVault-T-USDT": jettonVaultUsdtRewardJettonWalletBalanceBefore,
                    "ClaimHelper-T-USDT": usdtClaimHelperUsdtRewardJettonWalletBalanceBefore,
                    "Sender-T-USDT": senderUsdtRewardJettonWalletBalanceBefore,
                    "JettonVault-USDT": jettonVaultUsdtWalletBalanceBefore,
                    "ClaimHelper-USDT": 0,
                    "Sender-USDT": 0,
                },
                {
                    "JettonVault-T-USDT": jettonVaultUsdtRewardJettonWalletBalance,
                    "ClaimHelper-T-USDT": usdtClaimHelperUsdtRewardJettonWalletBalance,
                    "JettonVault-USDT": jettonVaultUsdtWalletBalance,
                    "Sender-T-USDT": senderUsdtRewardJettonWalletBalance,
                    "ClaimHelper-USDT": 0,
                    "Sender-USDT": senderUsdtWalletBalance,
                }
            ])
            expect(usdtClaimHelperUsdtRewardJettonWalletBalance - usdtClaimHelperUsdtRewardJettonWalletBalanceBefore).toEqual(claimAmount);
            expect(jettonVaultUsdtRewardJettonWalletBalance - jettonVaultUsdtRewardJettonWalletBalanceBefore).toEqual(toNano("0"));
            expect(senderUsdtRewardJettonWalletBalanceBefore - senderUsdtRewardJettonWalletBalance).toEqual(claimAmount);

            expect(jettonVaultUsdtWalletBalanceBefore - jettonVaultUsdtWalletBalance).toEqual(claimAmount);
            expect(senderUsdtWalletBalance).toEqual(claimAmount);

            // ┌─────────┬──────────────┬────────────────┬────────────────┬────────────────┬────────────────┬────────────────┬────────────┬────────────────┬──────────┬────────────┐
            // │ (index) │ op           │ valueIn        │ valueOut       │ totalFees      │ inForwardFee   │ outForwardFee  │ outActions │ computeFee     │ exitCode │ actionCode │
            // ├─────────┼──────────────┼────────────────┼────────────────┼────────────────┼────────────────┼────────────────┼────────────┼────────────────┼──────────┼────────────┤
            // │ 0       │ 'N/A'        │ 'N/A'          │ '0.7 TON'      │ '0.002061 TON' │ 'N/A'          │ '0.000775 TON' │ 1          │ '0.000775 TON' │ 0        │ 0          │
            // │ 1       │ '0x3ee943f1' │ '0.7 TON'      │ '0.69228 TON'  │ '0.004911 TON' │ '0.000517 TON' │ '0.004214 TON' │ 1          │ '0.003506 TON' │ 0        │ 0          │
            // │ 2       │ '0xce30d1dc' │ '0.69228 TON'  │ '0.662666 TON' │ '0.004357 TON' │ '0.00281 TON'  │ '0.001053 TON' │ 2          │ '0.004006 TON' │ 0        │ 0          │
            // │ 3       │ '0x4fb8dedc' │ '0.35 TON'     │ '0.299348 TON' │ '0.006515 TON' │ '0.000436 TON' │ '0.000681 TON' │ 1          │ '0.006288 TON' │ 0        │ 0          │
            // │ 4       │ '0x7d7aec1d' │ '0.312666 TON' │ '0 TON'        │ '0.000124 TON' │ '0.000267 TON' │ 'N/A'          │ 0          │ '0.000124 TON' │ 0        │ 0          │
            // │ 5       │ '0x2daf1323' │ '0.299348 TON' │ '0.05 TON'     │ '0.007443 TON' │ '0.000454 TON' │ '0.000709 TON' │ 1          │ '0.007206 TON' │ 0        │ 0          │
            // │ 6       │ '0xf8a7ea5'  │ '0.05 TON'     │ '0.033059 TON' │ '0.011073 TON' │ '0.000473 TON' │ '0.008804 TON' │ 1          │ '0.008138 TON' │ 0        │ 0          │
            // │ 7       │ '0x178d4519' │ '0.033059 TON' │ '0.003777 TON' │ '0.007272 TON' │ '0.00587 TON'  │ '0.000479 TON' │ 1          │ '0.007112 TON' │ 0        │ 0          │
            // │ 8       │ '0xd53276db' │ '0.003777 TON' │ '0 TON'        │ '0.000124 TON' │ '0.000319 TON' │ 'N/A'          │ 0          │ '0.000124 TON' │ 0        │ 0          │
            // └─────────┴──────────────┴────────────────┴────────────────┴────────────────┴────────────────┴────────────────┴────────────┴────────────────┴──────────┴────────────┘

            printTransactionFees(claimUsdtRewardResult.transactions)
            const totalTransactionFee = sumTransactionsFee(claimUsdtRewardResult.transactions);
            expect(totalTransactionFee).toBeLessThanOrEqual(0.044); // real: 0.043874311
        });
    });
});
