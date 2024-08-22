import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano, Address } from '@ton/core';
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
import { MockTay } from '../wrappers/MockTay';
import { TimeVestingMaster } from '../wrappers/TimeVestingMaster';
import { TimeVesting } from '../wrappers/TimeVesting';

describe('ClaimRewards', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let timeVestingMaster: SandboxContract<TimeVestingMaster>;
    let tay: SandboxContract<MockTay>;
    let usdt: SandboxContract<SampleJetton>;

    // FunC implemented jetton contract
    let rewardJettonMasterCode: Cell;
    let rewardJettonWalletCode: Cell;
    let usdtRewardJettonMaster: SandboxContract<RewardJettonMaster>;
    let usdtRewardJettonWallet: SandboxContract<JettonWallet>;
    let tayRewardJettonMaster: SandboxContract<RewardJettonMaster>;
    let tayRewardJettonWallet: SandboxContract<JettonWallet>;

    let jettonVault: SandboxContract<JettonVault>;
    let usdtClaimHelper: SandboxContract<ClaimHelper>;
    let tayClaimHelper: SandboxContract<ClaimHelper>;
    let constructJettonWalletConfig: any;
    let constructRewardJettonMasterConfig: any;

    let mintMockTay: any;

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
        const tayJettonParams = {
            ...jettonParams,
            name: 'TonLayer Token',
            description: 'TonLayer Token',
            symbol: "TAY",
            decimal: "9",
        }
        const tayRewardJettonParams = {
            ...jettonParams,
            name: 'TAY-Reward-Jetton',
            description: 'TonLayer Reward Token',
            symbol: "T-TAY",
            decimal: "9",
        }

        // It's the largest value I can use for max_supply in the tests
        let max_supply = (1n << 120n) - 1n;
        // let max_supply = toNano(1000000n); // 🔴 Set the specific total supply in nano
        let content = buildOnchainMetadata(jettonParams);
        let tayContent = buildOnchainMetadata(tayJettonParams);
        let usdtRewardJettonContent = buildOnchainMetadata(usdtRewardJettonParams);
        let tayRewardJettonContent = buildOnchainMetadata(tayRewardJettonParams);

        usdt = blockchain.openContract(await SampleJetton.fromInit(deployer.address, content, max_supply));
        tay = blockchain.openContract(await MockTay.fromInit(deployer.address, tayContent, max_supply));
        timeVestingMaster = blockchain.openContract(await TimeVestingMaster.fromInit());

        rewardJettonWalletCode = await compile('JettonWallet');
        rewardJettonMasterCode = await compile('RewardJettonMaster');

        constructRewardJettonMasterConfig = (ownerAddress: Address, contentData: any) =>
            blockchain.openContract(RewardJettonMaster.createFromConfig(
                {
                    admin: ownerAddress,
                    content: contentData,
                    walletCode: rewardJettonWalletCode,
                },
                rewardJettonMasterCode
            ));

        constructJettonWalletConfig = (ownerAddress: Address, minterAddress: Address) =>
            blockchain.openContract(
                JettonWallet.createFromConfig(
                    {
                        owner: ownerAddress,
                        minter: minterAddress,
                        walletCode: rewardJettonWalletCode,
                    },
                    rewardJettonWalletCode
                ));

        usdtRewardJettonMaster = constructRewardJettonMasterConfig(deployer.address, usdtRewardJettonContent);
        usdtRewardJettonWallet = constructJettonWalletConfig(deployer.address, usdtRewardJettonMaster.address)
        tayRewardJettonMaster = constructRewardJettonMasterConfig(deployer.address, tayRewardJettonContent);
        tayRewardJettonWallet = constructJettonWalletConfig(deployer.address, tayRewardJettonMaster.address)

        jettonVault = blockchain.openContract(await JettonVault.fromInit());
        const usdtDeployResult = await usdt.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );
        expect(usdtDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: usdt.address,
            deploy: true,
            success: true,
        });

        const tayDeployResult = await tay.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );
        expect(tayDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: tay.address,
            deploy: true,
            success: true,
        });
        await timeVestingMaster.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );
        const timeVestingMasterTayWallet = await tay.getGetWalletAddress(timeVestingMaster.address);
        await timeVestingMaster.send(
            deployer.getSender(),
            {
                value: toNano('0.5'),
            },
            {
                $$type: 'SetTayWallet',
                tayWallet: timeVestingMasterTayWallet,
            },
        );
        mintMockTay = async (jetton: SandboxContract<MockTay>, receiver: Address, amount: bigint) => {
            await jetton.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'Mint',
                    queryId: 0n,
                    amount,
                    receiver,
                },
            );
        };

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
        const deployTayRewardJetton = await tayRewardJettonMaster.sendDeploy(
            deployer.getSender(),
            toNano('0.05'),
        );
        expect(deployTayRewardJetton.transactions).toHaveTransaction({
            from: deployer.address,
            to: tayRewardJettonMaster.address,
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

                $$type: 'SetJettonWalletAddress',
                newAddress: jettonVaultUsdtWalletAddress,
            },
        )

        const jettonVaultTayWalletAddress = await tay.getGetWalletAddress(jettonVault.address);
        await jettonVault.send(
            deployer.getSender(),
            {
                value: toNano("0.05"),
            },
            {

                $$type: 'SetJettonWalletAddress',
                newAddress: jettonVaultTayWalletAddress,
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
        tayClaimHelper = blockchain.openContract(await ClaimHelper.fromInit(tayRewardJettonMaster.address, jettonVault.address));
        await tayClaimHelper.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        )

        const usdtClaimHelperUsdtRewardJettonWalletAddress = await usdtRewardJettonMaster.getWalletAddress(usdtClaimHelper.address);
        await usdtClaimHelper.send(
            deployer.getSender(),
            {
                value: toNano("0.05"),
            },
            {

                $$type: 'SetJettonWalletAddress',
                newAddress: usdtClaimHelperUsdtRewardJettonWalletAddress,
            },
        )
        const tayClaimHelperTayRewardJettonWalletAddress = await tayRewardJettonMaster.getWalletAddress(tayClaimHelper.address);
        await tayClaimHelper.send(
            deployer.getSender(),
            {
                value: toNano("0.05"),
            },
            {

                $$type: 'SetJettonWalletAddress',
                newAddress: tayClaimHelperTayRewardJettonWalletAddress,
            },
        )

        const setUsdtClaimable = await jettonVault.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'ConfigureClaimableConfiguration',
                originJettonAddress: usdtRewardJettonMaster.address,
                jettonWalletAddress: jettonVaultUsdtWalletAddress,
                targetBeneficiary: jettonVaultUsdtWalletAddress,
                claimType: 0n,
                claimHelper: usdtClaimHelper.address,
            },
        );
        expect(setUsdtClaimable.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonVault.address,
            success: true,
        });

        const setTayClaimable = await jettonVault.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'ConfigureClaimableConfiguration',
                originJettonAddress: tayRewardJettonMaster.address,
                jettonWalletAddress: jettonVaultTayWalletAddress,
                targetBeneficiary: timeVestingMaster.address,
                claimType: 1n,
                claimHelper: tayClaimHelper.address,
            },
        );
        expect(setTayClaimable.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonVault.address,
            success: true,
        });

        // const mapping = await jettonVault.getAllClaimableJettonMapping();
        // console.log(mapping);
    });

    describe('claim USDT & TAY rewards', () => {
        it('should claim USDT successfully', async () => {
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

            const jettonVaultUsdtRewardJettonWallet = constructJettonWalletConfig(jettonVault.address, usdtRewardJettonMaster.address)
            const usdtClaimHelperUsdtRewardJettonWallet = constructJettonWalletConfig(usdtClaimHelper.address, usdtRewardJettonMaster.address)
            const senderUsdtRewardJettonWallet = constructJettonWalletConfig(senderAddress, usdtRewardJettonMaster.address)

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
                from: jettonVault.address,
                to: jettonVaultUsdtWalletAddress,
                outMessagesCount: 1,
                success: true,
            })
            // op::internal_transfer message
            expect(claimUsdtRewardResult.transactions).toHaveTransaction({
                from: jettonVaultUsdtWalletAddress,
                to: senderUsdtWalletAddress,
                oldStatus: "uninitialized",
                endStatus: "active",
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

            expect(usdtClaimHelperUsdtRewardJettonWalletBalance - usdtClaimHelperUsdtRewardJettonWalletBalanceBefore).toEqual(claimAmount);
            expect(jettonVaultUsdtRewardJettonWalletBalance - jettonVaultUsdtRewardJettonWalletBalanceBefore).toEqual(toNano("0"));
            expect(senderUsdtRewardJettonWalletBalanceBefore - senderUsdtRewardJettonWalletBalance).toEqual(claimAmount);

            expect(jettonVaultUsdtWalletBalanceBefore - jettonVaultUsdtWalletBalance).toEqual(claimAmount);
            expect(senderUsdtWalletBalance).toEqual(claimAmount);

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
                    "Sender-T-USDT": senderUsdtRewardJettonWalletBalance,
                    "JettonVault-USDT": jettonVaultUsdtWalletBalance,
                    "ClaimHelper-USDT": 0,
                    "Sender-USDT": senderUsdtWalletBalance,
                }
            ])
            // ┌─────────┬────────────────────┬────────────────────┬───────────────┬──────────────────┬──────────────────┬─────────────┐
            // │ (index) │ JettonVault-T-USDT │ ClaimHelper-T-USDT │ Sender-T-USDT │ JettonVault-USDT │ ClaimHelper-USDT │ Sender-USDT │
            // ├─────────┼────────────────────┼────────────────────┼───────────────┼──────────────────┼──────────────────┼─────────────┤
            // │ 0       │ 0n                 │ 0n                 │ 1000000000n   │ 1000000000n      │ 0                │ 0           │
            // │ 1       │ 0n                 │ 300000000n         │ 700000000n    │ 700000000n       │ 0                │ 300000000n  │
            // └─────────┴────────────────────┴────────────────────┴───────────────┴──────────────────┴──────────────────┴─────────────┘

            // printTransactionFees(claimUsdtRewardResult.transactions)
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
            const totalTransactionFee = sumTransactionsFee(claimUsdtRewardResult.transactions);
            expect(totalTransactionFee).toBeLessThanOrEqual(0.045076311); // real: 0.044076311
        });

        it('should claim TAY successfully', async () => {
            await mintMockTay(tay, jettonVault.address, toNano("1"));
            const sender = deployer.getSender();
            const senderAddress = sender.address;

            const mintAmount = toNano("1")
            const mintTayRewardJettonResult = await tayRewardJettonMaster.sendMint(
                sender,
                senderAddress,
                mintAmount,
                toNano('0.05'),
                toNano('0.06'),
            );
            expect(mintTayRewardJettonResult.transactions).toHaveTransaction({
                from: await tayRewardJettonMaster.getWalletAddress(senderAddress),
                to: senderAddress,
                oldStatus: "active",
                endStatus: "active",
                success: true,
            });

            const jettonVaultTayRewardJettonWalletAddress = await tayRewardJettonMaster.getWalletAddress(jettonVault.address);
            const senderTayRewardJettonWalletAddress = await tayRewardJettonMaster.getWalletAddress(senderAddress);
            const tayClaimHelperTayRewardJettonWalletAddress = await tayRewardJettonMaster.getWalletAddress(tayClaimHelper.address);
            const jettonVaultTayWalletAddress = await tay.getGetWalletAddress(jettonVault.address);
            const senderTayWalletAddress = await tay.getGetWalletAddress(senderAddress);
            const tayClaimHelperWalletAddress = await tay.getGetWalletAddress(tayClaimHelper.address);
            const timeVestingMasterTayWalletAddress = await tay.getGetWalletAddress(timeVestingMaster.address);

            const jettonVaultTayRewardJettonWallet = constructJettonWalletConfig(jettonVault.address, tayRewardJettonMaster.address)
            const tayClaimHelperTayRewardJettonWallet = constructJettonWalletConfig(tayClaimHelper.address, tayRewardJettonMaster.address)
            const senderTayRewardJettonWallet = constructJettonWalletConfig(senderAddress, tayRewardJettonMaster.address)
            const timeVestingRewardJettonWallet = constructJettonWalletConfig(timeVestingMaster.address, tayRewardJettonMaster.address)
            const timeVestingMasterTayWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(timeVestingMasterTayWalletAddress));

            const jettonVaultTayWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(jettonVaultTayWalletAddress));
            // const senderTayWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(senderTayWalletAddress));
            // const tayClaimHelperWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(tayClaimHelperWalletAddress));

            const senderTayRewardJettonWalletBalanceBefore = await senderTayRewardJettonWallet.getJettonBalance();
            const tayClaimHelperTayRewardJettonWalletBalanceBefore = await tayClaimHelperTayRewardJettonWallet.getJettonBalance();
            const jettonVaultTayRewardJettonWalletBalanceBefore = await jettonVaultTayRewardJettonWallet.getJettonBalance();

            // const timeVestingMasterTayWalletBalanceBefore = (await timeVestingMasterTayWallet.getGetWalletData()).balance;
            const jettonVaultTayWalletBalanceBefore = (await jettonVaultTayWallet.getGetWalletData()).balance;

            const claimAmount = toNano("0.3");
            // MessageFlow
            // 1. (external) undefined => senderAddress
            // 2. (op::transfer) senderAddress => senderTayRewardJettonWalletAddress
            // 3. (op::internal_transfer) senderTayRewardJettonWalletAddress => tayClaimHelperTayRewardJettonWalletAddress
            // 4. (op::transfer_notification) tayClaimHelperTayRewardJettonWalletAddress => tayClaimHelper
            // 5. (op::excesses) tayClaimHelperTayRewardJettonWalletAddress => senderAddress
            // 6. (ClaimReward) tayClaimHelper => jettonVault
            // 7. (TokenTransfer) jettonVault => jettonVaultTayWalletAddress
            // 8. (InternalTransfer) jettonVaultTayWalletAddress => timeVestingMasterTayWallet
            // 9. (TokenNotification) timeVestingMasterTayWallet => timeVestingMaster
            // 10.(Excesses) timeVestingMasterTayWallet => senderAddress
            // 11.(AddLock) timeVestingMaster => senderTimeVestingMasterWalletAddress
            // 12.(SelfReply) senderTimeVestingMasterWalletAddress => senderAddress
            const claimTayRewardResult = await tayRewardJettonWallet.sendTransfer(
                sender,
                toNano('0.2'),
                toNano('0.3'),
                tayClaimHelper.address,
                claimAmount,
                beginCell().storeUint(0x7994ff68, 32).endCell(), // opcode: ClaimReward
            );

            const senderTimeVestingMasterWalletAddress = await timeVestingMaster.getUserTimeVestingAddress(deployer.address);
            // console.log({
            //     senderAddress: deployer.getSender().address.toString(),
            //     tay: tay.address.toString(),
            //     tayRewardJettonMaster: tayRewardJettonMaster.address.toString(),
            //     tayClaimHelper: tayClaimHelper.address.toString(),
            //     jettonVault: jettonVault.address.toString(),
            //     jettonVaultTayRewardJettonWalletAddress: jettonVaultTayRewardJettonWalletAddress.toString(),
            //     senderTayRewardJettonWalletAddress: senderTayRewardJettonWalletAddress.toString(),
            //     tayClaimHelperTayRewardJettonWalletAddress: tayClaimHelperTayRewardJettonWallet.address.toString(),
            //     jettonVaultTayWalletAddress: jettonVaultTayWalletAddress.toString(),
            //     senderTayWalletAddress: senderTayWalletAddress.toString(),
            //     tayClaimHelperWalletAddress: tayClaimHelperWalletAddress.toString(),
            //     timeVestingMaster: timeVestingMaster.address.toString(),
            //     senderTimeVestingMasterWalletAddress: senderTimeVestingMasterWalletAddress.toString(),
            //     timeVestingMasterTayWalletAddress: timeVestingMasterTayWalletAddress.toString(),
            // })

            // 1. external message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: undefined,
                to: senderAddress,
                outMessagesCount: 1,
                success: true,
            });
            // 2. op::transfer message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: senderAddress,
                to: senderTayRewardJettonWalletAddress,
                outMessagesCount: 1,
                success: true,
            });
            // 3. op::internal_transfer message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: senderTayRewardJettonWalletAddress,
                to: tayClaimHelperTayRewardJettonWalletAddress,
                outMessagesCount: 2,
                oldStatus: "uninitialized",
                endStatus: "active",
                success: true,
            });
            // 4. op::transfer_notification message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: tayClaimHelperTayRewardJettonWalletAddress,
                to: tayClaimHelper.address,
                outMessagesCount: 1,
                success: true,
            });
            // 5. op::excesses message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: tayClaimHelperTayRewardJettonWalletAddress,
                to: senderAddress,
                outMessagesCount: 0,
                success: true,
            })
            // 6. ClaimReward message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: tayClaimHelper.address,
                to: jettonVault.address,
                outMessagesCount: 1,
                success: true,
            })
            // 7. TokenTransfer message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: jettonVault.address,
                to: jettonVaultTayWalletAddress,
                outMessagesCount: 1,
                success: true,
            })
            // 8. InternalTransfer message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: jettonVaultTayWalletAddress,
                to: timeVestingMasterTayWalletAddress,
                oldStatus: "uninitialized",
                endStatus: "active",
                outMessagesCount: 2,
                success: true,
            })
            // 9. TokenNotification message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: timeVestingMasterTayWalletAddress,
                to: timeVestingMaster.address,
                success: true,
            });
            // 10. Excesses message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: timeVestingMasterTayWalletAddress,
                to: senderAddress,
                success: true,
            });
            // 11. AddLock message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: timeVestingMaster.address,
                to: senderTimeVestingMasterWalletAddress,
                success: true,
            });
            // 12. SelfReply message
            expect(claimTayRewardResult.transactions).toHaveTransaction({
                from: senderTimeVestingMasterWalletAddress,
                to: senderAddress,
                success: true,
            });

            const deployerTimeVesting = blockchain.openContract(
                TimeVesting.fromAddress(await timeVestingMaster.getUserTimeVestingAddress(senderAddress)),
            );
            const lockedTAY = await deployerTimeVesting.getTimeVestingData();
            console.log(lockedTAY);

            // const jettonVaultTayRewardJettonWalletBalance = await jettonVaultTayRewardJettonWallet.getJettonBalance();
            const tayClaimHelperTayRewardJettonWalletBalance = await tayClaimHelperTayRewardJettonWallet.getJettonBalance();
            const senderTayRewardJettonWalletBalance = await senderTayRewardJettonWallet.getJettonBalance();

            // const senderTayWalletBalance = (await senderTayWallet.getGetWalletData()).balance;
            // const tayClaimHelperWalletBalance = (await tayClaimHelperWallet.getGetWalletData()).balance;
            const jettonVaultTayWalletBalance = (await jettonVaultTayWallet.getGetWalletData()).balance;
            // const timeVestingMasterTayWalletBalance = (await tay.getGetWalletAddress(timeVestingMasterTayWallet))
            const timeVestingMasterTayWalletBalance = (await timeVestingMasterTayWallet.getGetWalletData()).balance
            // (await tay.getGetWalletData(timeVestingMasterTayWallet)).balance;

            expect(tayClaimHelperTayRewardJettonWalletBalance - tayClaimHelperTayRewardJettonWalletBalanceBefore).toEqual(claimAmount);
            expect(jettonVaultTayWalletBalanceBefore - jettonVaultTayWalletBalance).toEqual(claimAmount);
            expect(senderTayRewardJettonWalletBalanceBefore - senderTayRewardJettonWalletBalance).toEqual(claimAmount);
            expect(timeVestingMasterTayWalletBalance).toEqual(claimAmount);

            console.table([
                {
                    "JettonVault-T-TAY": jettonVaultTayRewardJettonWalletBalanceBefore,
                    "ClaimHelper-T-TAY": tayClaimHelperTayRewardJettonWalletBalanceBefore,
                    "Sender-T-TAY": senderTayRewardJettonWalletBalanceBefore,
                    "JettonVault-TAY": jettonVaultTayWalletBalanceBefore,
                    "ClaimHelper-TAY": 0,
                    "Sender-TAY": 0,
                    "TimeVesting-TAY": 0,
                },
                {
                    "JettonVault-T-TAY": 0,
                    "ClaimHelper-T-TAY": tayClaimHelperTayRewardJettonWalletBalance,
                    "Sender-T-TAY": senderTayRewardJettonWalletBalance,
                    "JettonVault-TAY": jettonVaultTayWalletBalance,
                    "ClaimHelper-TAY": 0,
                    "Sender-TAY": 0,
                    "TimeVesting-TAY": timeVestingMasterTayWalletBalance,
                }
            ])
            // ┌─────────┬───────────────────┬───────────────────┬──────────────┬─────────────────┬─────────────────┬────────────┬─────────────────┐
            // │ (index) │ JettonVault-T-TAY │ ClaimHelper-T-TAY │ Sender-T-TAY │ JettonVault-TAY │ ClaimHelper-TAY │ Sender-TAY │ TimeVesting-TAY │
            // ├─────────┼───────────────────┼───────────────────┼──────────────┼─────────────────┼─────────────────┼────────────┼─────────────────┤
            // │ 0       │ 0n                │ 0n                │ 1000000000n  │ 1000000000n     │ 0               │ 0          │ 0               │
            // │ 1       │ 0                 │ 300000000n        │ 700000000n   │ 700000000n      │ 0               │ 0          │ 300000000n      │
            // └─────────┴───────────────────┴───────────────────┴──────────────┴─────────────────┴─────────────────┴────────────┴─────────────────┘

            // printTransactionFees(claimTayRewardResult.transactions)
            // ┌─────────┬──────────────┬────────────────┬────────────────┬────────────────┬────────────────┬────────────────┬────────────┬────────────────┬──────────┬────────────┐
            // │ (index) │ op           │ valueIn        │ valueOut       │ totalFees      │ inForwardFee   │ outForwardFee  │ outActions │ computeFee     │ exitCode │ actionCode │
            // ├─────────┼──────────────┼────────────────┼────────────────┼────────────────┼────────────────┼────────────────┼────────────┼────────────────┼──────────┼────────────┤
            // │ 0       │ 'N/A'        │ 'N/A'          │ '0.5 TON'      │ '0.002061 TON' │ 'N/A'          │ '0.000775 TON' │ 1          │ '0.000775 TON' │ 0        │ 0          │
            // │ 1       │ '0x3ee943f1' │ '0.5 TON'      │ '0.49228 TON'  │ '0.004911 TON' │ '0.000517 TON' │ '0.004214 TON' │ 1          │ '0.003506 TON' │ 0        │ 0          │
            // │ 2       │ '0xce30d1dc' │ '0.49228 TON'  │ '0.462666 TON' │ '0.004357 TON' │ '0.00281 TON'  │ '0.001053 TON' │ 2          │ '0.004006 TON' │ 0        │ 0          │
            // │ 3       │ '0x4fb8dedc' │ '0.3 TON'      │ '0.249348 TON' │ '0.006334 TON' │ '0.000436 TON' │ '0.000681 TON' │ 1          │ '0.006107 TON' │ 0        │ 0          │
            // │ 4       │ '0x7d7aec1d' │ '0.162666 TON' │ '0 TON'        │ '0.000124 TON' │ '0.000267 TON' │ 'N/A'          │ 0          │ '0.000124 TON' │ 0        │ 0          │
            // │ 5       │ '0x2daf1323' │ '0.249348 TON' │ '0.240457 TON' │ '0.00833 TON'  │ '0.000454 TON' │ '0.000841 TON' │ 1          │ '0.00805 TON'  │ 0        │ 0          │
            // │ 6       │ '0xf8a7ea5'  │ '0.240457 TON' │ '0.223441 TON' │ '0.011098 TON' │ '0.000561 TON' │ '0.008879 TON' │ 1          │ '0.008138 TON' │ 0        │ 0          │
            // │ 7       │ '0x178d4519' │ '0.223441 TON' │ '0.194084 TON' │ '0.009068 TON' │ '0.005919 TON' │ '0.001198 TON' │ 2          │ '0.008668 TON' │ 0        │ 0          │
            // │ 8       │ '0x7362d09c' │ '0.04 TON'     │ '0.02627 TON'  │ '0.009667 TON' │ '0.00048 TON'  │ '0.006097 TON' │ 1          │ '0.007634 TON' │ 0        │ 0          │
            // │ 9       │ '0xd53276db' │ '0.154084 TON' │ '0 TON'        │ '0.000124 TON' │ '0.000319 TON' │ 'N/A'          │ 0          │ '0.000124 TON' │ 0        │ 0          │
            // │ 10      │ '0xf0e97869' │ '0.02627 TON'  │ '0.001106 TON' │ '0.004819 TON' │ '0.004065 TON' │ '0.000517 TON' │ 2          │ '0.004647 TON' │ 0        │ 0          │
            // │ 11      │ '0x0'        │ '0.001106 TON' │ '0 TON'        │ '0.000124 TON' │ '0.000345 TON' │ 'N/A'          │ 0          │ '0.000124 TON' │ 0        │ 0          │
            // └─────────┴──────────────┴────────────────┴────────────────┴────────────────┴────────────────┴────────────────┴────────────┴────────────────┴──────────┴────────────┘
            const totalTransactionFee = sumTransactionsFee(claimTayRewardResult.transactions);
            expect(totalTransactionFee).toBeLessThanOrEqual(0.062); // real: 0.06101040500000001
        });
    });
});
