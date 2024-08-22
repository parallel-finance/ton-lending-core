import "@stdlib/ownable";
import "@stdlib/deploy";
import "@stdlib/stoppable";
import "../jetton/messages";
import "./sTay";
message SetLockPeriod {
    lockingPeriod: Int;
}
message SetLpWallet {
    lpWallet: Address;
}
message AddRewardTokens {
    tokens: map<Address, Address>; // token -> jetton wallet address
}
message ClaimReward {
    user: Address;
    token: Address;
}
message Withdraw {
    lockIndex: Int as uint32;
}
message CheckUserExpiredLock {
    user: Address;
}
struct TokenReward {
    tokenIndex: Int as uint8; // token index
    jettonWallet: Address; // jetton wallet address of this jetton
    periodEndTime: Int as uint32; // End time of the reward period
    rewardPerSecond: Int; // Reward rate per second
    accRewardPerShare: Int; // accumulated reward per share
    balance: Int as coins; // Current balance of rewards
    lastUpdateTime: Int as uint32; // Time of the last update
}
struct STayMasterData {
    owner: Address;
    stopped: Bool;
    lpWallet: Address?;
    lockingPeriod: Int as uint32;
    totalLockedLp: Int as coins;
    lpBalance: Int as coins;
    index: Int as uint8;
    tokenRewards: map<Address, TokenReward>;
}

contract STayMaster with Ownable, Deployable, Resumable {
    override const storageReserve: Int = ton("0.01");
    const GAS_CONSUMPTION: Int = ton("0.01");
    owner: Address;
    stopped: Bool;
    // self stonfi TAY-TON lp jetton wallet
    lpWallet: Address?;
    // 90 days 90 * 24 * 60 * 60
    lockingPeriod: Int as uint32 = 7776000;
    // total locked lp amount
    totalLockedLp: Int as coins = 0;
    // total locked lp + total expired lp
    lpBalance: Int as coins = 0;
    // token index
    index: Int as uint8 = 0;
    // token reward info
    tokenRewards: map<Address, TokenReward>;

    init(){
        self.owner = sender();
        self.stopped = false;
    }

    // ====== Received Messages ====== //

    receive(msg: TokenNotification){
        self.processTokenNotification(msg);
    }

    receive(msg: ClaimReward) {
        self.claimReward(msg);
    }

    receive(msg: StoredRewardCleared) {
        self.transferRewardToUser(msg);
    }

    receive(msg: UserLockRemoved) {
        self.transferLpToUser(msg);
    }

    receive(msg: CheckUserExpiredLock) {
        self.checkUserExpiredLock(msg);
    }

    receive(msg: ExpiredLockUpdated) {
        self.expiredLockUpdated(msg);
    }

    receive(msg: SetLockPeriod){
        self.requireOwner();
        self.lockingPeriod = msg.lockingPeriod;
        self.reply("SetLockPeriod successfully".asComment());
    }

    receive(msg: SetLpWallet){
        self.requireOwner();
        self.lpWallet = msg.lpWallet;
        self.reply("SetLpWallet successfully".asComment());
    }

    // add reward tokens or update jettonWallet
    receive(msg: AddRewardTokens){
        self.requireOwner();
        foreach (token, jettonWallet in msg.tokens) {
            let _tokenReward: TokenReward? = self.tokenRewards.get(token);
            if(_tokenReward == null) {
                self.tokenRewards.set(token, TokenReward{
                    tokenIndex: self.index,
                    jettonWallet: jettonWallet,
                    periodEndTime: now(),
                    rewardPerSecond: 0,
                    accRewardPerShare: 0,
                    balance: 0,
                    lastUpdateTime: now()
                });
                self.index += 1;
            } else {
                let tokenReward: TokenReward = _tokenReward!!;
                tokenReward.jettonWallet = jettonWallet;
                self.tokenRewards.set(token, tokenReward);
            }
            
        }
        self.reply("AddRewardTokens successfully".asComment());
    }

    receive(msg: TokenExcesses){}

    // ====== Internal Methods ====== //

    fun processTokenNotification(msg: TokenNotification) {
        let opCode: Int = msg.forward_payload.loadUint(32);
        // utils.calculateRequestOpcode_1("MintSTay")
        if (opCode == 0x100a9c18 && sender() == self.lpWallet!!) {
            self.mintSTay(msg);
        }
        // utils.calculateRequestOpcode_1("DepositReward")
        if (opCode == 0x7a6dcdd7) {
            self.depositReward(msg);
        }
    }

    fun mintSTay(msg: TokenNotification) {
        let user: Address = msg.forward_payload.loadAddress();
        // dump(user);
        let latestTokenRewardPerShares: map<Address, Int> = self.updateTokenRewards(true);
        self.totalLockedLp += msg.amount;
        self.lpBalance += msg.amount;

        let userSTayInit: StateInit = self.userSTayStateInit(user);
        self.forward(
            contractAddress(userSTayInit),
            MintSTay{
                user: user, 
                amount: msg.amount, 
                releaseTime: now() + self.lockingPeriod,
                tokenRewardPerShares: latestTokenRewardPerShares
            }.toCell(),
            false,
            userSTayInit
        );
    }

    fun claimReward(msg: ClaimReward) {
        let userSTayAddress: Address = self.userSTayAddress(msg.user);
        let tokenReward: TokenReward = self.tokenRewards.get(msg.token)!!;
        let latestTokenRewardPerShares: map<Address, Int> = self.updateTokenRewards(true);
        // TODO add gas check
        
        self.forward(
            userSTayAddress,
            ClearUserStoredReward{
                token: msg.token,
                tokenIndex: tokenReward.tokenIndex,
                tokenRewardPerShares: latestTokenRewardPerShares
            }.toCell(),
            false,
            null
        );
    }

    fun transferRewardToUser(msg: StoredRewardCleared) {
        self.requireFromUserSTay(msg.user);
        let token: Address = msg.token != null ? msg.token!!: self.findTokenAddressByIndex(msg.tokenIndex)!!;
        let tokenReward: TokenReward = self.tokenRewards.get(token)!!;
        // pre-check the reward balance
        tokenReward.balance -= msg.amount;
        self.tokenRewards.set(token, tokenReward);
        self.forward(tokenReward.jettonWallet,
            TokenTransfer{
                queryId: 0,
                amount: msg.amount,
                destination: msg.user,
                response_destination: msg.user,
                custom_payload: null,
                forward_ton_amount: 0,
                forward_payload: emptySlice()
            }.toCell(),
            false,
            null
        );
    }

    fun transferLpToUser(msg: UserLockRemoved) {
        self.requireFromUserSTay(msg.user);
        // pre-check the lp balance
        self.lpBalance -= msg.amount;
        self.forward(self.lpWallet!!,
            TokenTransfer{
                queryId: 0,
                amount: msg.amount,
                destination: msg.user,
                response_destination: msg.user,
                custom_payload: null,
                forward_ton_amount: 0,
                forward_payload: emptySlice()
            }.toCell(),
            false,
            null
        );
    }

    fun checkUserExpiredLock(msg: CheckUserExpiredLock) {
        let userSTayAddress: Address = self.userSTayAddress(msg.user);
        let latestTokenRewardPerShares: map<Address, Int> = self.updateTokenRewards(true);
        // TODO add gas check
        
        self.forward(
            userSTayAddress,
            UpdateExpiredLock{
                tokenRewardPerShares: latestTokenRewardPerShares,
                responseDestination: sender()
            }.toCell(),
            false,
            null
        );
    }

    fun expiredLockUpdated(msg: ExpiredLockUpdated) {
        self.requireFromUserSTay(msg.user);
        self.totalLockedLp -= msg.amount;
        self.forward(msg.responseDestination, emptyCell(), false, null);
    }

    fun updateTokenRewards(updateStorage: Bool): map<Address, Int> {
        let latestTokenRewardPerShares: map<Address, Int> = emptyMap();
        let now: Int = now();
        let tokenRewards: map<Address, TokenReward> = self.tokenRewards;
        foreach (token, rewardInfo in tokenRewards) {
            if (self.totalLockedLp > 0) {
                let lastRewardableTime: Int = now < rewardInfo.periodEndTime ? now : rewardInfo.periodEndTime;
                let newReward: Int = (lastRewardableTime - rewardInfo.lastUpdateTime) * rewardInfo.rewardPerSecond;

                rewardInfo.accRewardPerShare += newReward * REWARD_PRECISION / self.totalLockedLp;
                rewardInfo.lastUpdateTime = lastRewardableTime;

                if (updateStorage) {
                    self.tokenRewards.set(token, rewardInfo);
                }
            }
            latestTokenRewardPerShares.set(token, rewardInfo.accRewardPerShare);
        }
        return latestTokenRewardPerShares;
    }

    fun depositReward(msg: TokenNotification) {
        let token: Address = self.findTokenAddressByJettonWallet(sender())!!;
        let tokenReward: TokenReward = self.tokenRewards.get(token)!!;
        tokenReward.balance += msg.amount;
        tokenReward.periodEndTime = now();
        tokenReward.rewardPerSecond = (msg.amount * REWARD_PRECISION) / (now() - tokenReward.lastUpdateTime);
        self.tokenRewards.set(token, tokenReward);
    }

    fun remainingValue(value: Int, selfConsumption: Int): Int {
        let msgValue: Int = value;
        let tonBalanceBeforeMsg: Int = myBalance() - msgValue;
        let storageFee: Int = self.storageReserve - min(tonBalanceBeforeMsg, self.storageReserve);
        msgValue = msgValue - (storageFee + selfConsumption);
        return msgValue;
    }

    fun requireFromUserSTay(user: Address) {
        require(sender() == self.userSTayAddress(user), "Not from user STay contract");
    }

    fun findTokenAddressByIndex(tokenIndex: Int): Address? {
        foreach (token, tokenReward in self.tokenRewards) {
            if (tokenReward.tokenIndex == tokenIndex) {
                return token;
            } 
        }
        return null;
    }

    fun findTokenAddressByJettonWallet(wallet: Address): Address? {
        foreach (token, tokenReward in self.tokenRewards) {
            if (tokenReward.jettonWallet == wallet) {
                return token;
            } 
        }
        return null;
    }
    // ====== Get Methods ====== //

    get fun userSTayStateInit(user: Address): StateInit {
        return initOf STay(myAddress(), user);
    }

    get fun userSTayAddress(user: Address): Address {
        return contractAddress(self.userSTayStateInit(user));
    }

    get fun latestTokenRewardPerShares(): map<Address, Int> {
        return self.updateTokenRewards(false);
    }

    get fun sTayMasterData(): STayMasterData {
        return STayMasterData{
            owner: self.owner,
            stopped: self.stopped,
            lpWallet: self.lpWallet,
            lockingPeriod: self.lockingPeriod,
            totalLockedLp: self.totalLockedLp,
            lpBalance: self.lpBalance,
            index: self.index,
            tokenRewards: self.tokenRewards
        };
    }
}