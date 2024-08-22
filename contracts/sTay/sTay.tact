import "@stdlib/ownable";
import "@stdlib/deploy";
import "@stdlib/stoppable";
import "../jetton/messages";
struct LockedLP {
    amount: Int as coins; // Amount of tokens locked
    releaseTime: Int as uint32; // Time when tokens will be released
    isExpirationChecked: Bool; // if the LockedLP has been checked by offline
}
struct UserTokenReward {
    // stored rewards per user
    storedReward: Int as coins;
    // paidRewardsPerShare keeps track of the cumulative rewards that have been calculated for a user, up to the last update,
    // to prevent re-calculation and ensure accurate distribution of rewards.
    paidRewardsPerShare: Int;
}
struct UserSTayData {
    master: Address;
    owner: Address;
    locked: Int as coins = 0;
    index: Int as uint32 = 0;
    locks: map<Int as uint32, LockedLP>;
    tokenRewards: map<Address, UserTokenReward>;
    bouncedTokenRewards: map<Int as uint8, Int>;
    bouncedWithdrawAmount: Int as coins;
    autoRelock: Bool = true;
}
message MintSTay {
    user: Address;
    amount: Int as coins;
    releaseTime: Int as uint32;
    tokenRewardPerShares: map<Address, Int>;
}
message SetAutoRelock {
    autoRelock: Bool;
}
message ClearUserStoredReward {
    token: Address;
    tokenIndex: Int as uint8;
    tokenRewardPerShares: map<Address, Int>;
}
message StoredRewardCleared {
    amount: Int as coins;
    tokenIndex: Int as uint8;
    token: Address?;
    user: Address;
}
message ClaimBouncedTokenReward {
    tokenIndex: Int as uint8;
}
message RemoveUserLock {
    tokenRewardPerShares: map<Address, Int>;
    lockIndex: Int as uint32;
}
message UserLockRemoved {
    amount: Int as coins;
    user: Address;
}
message UpdateExpiredLock {
    responseDestination: Address;
    tokenRewardPerShares: map<Address, Int>;
}
message ExpiredLockUpdated {
    user: Address;
    amount: Int as coins;
    responseDestination: Address;
}
// 10**9
const REWARD_PRECISION: Int = 1000000000;

contract STay {
    override const storageReserve: Int = ton("0.02");
    // const GAS_CONSUMPTION: Int = ton("0.02");
    master: Address;
    owner: Address;
    locked: Int as coins = 0;
    index: Int as uint32 = 0;
    locks: map<Int as uint32, LockedLP>;
    tokenRewards: map<Address, UserTokenReward>;
    bouncedTokenRewards: map<Int as uint8, Int>;
    bouncedWithdrawAmount: Int as coins = 0;
    autoRelock: Bool = true;
    init(master: Address, owner: Address){
        self.owner = owner;
        self.master = master;
    }

    // ====== Received Messages ====== //
    receive(msg: MintSTay){
        self.mintSTay(msg);
    }

    receive(msg: ClearUserStoredReward){
        self.clearStoredReward(msg);
    }

    receive(msg: SetAutoRelock){
        self.requireFromOwner();
        self.autoRelock = msg.autoRelock;
    }

    receive(msg: ClaimBouncedTokenReward){
        self.claimBouncedTokenReward(msg);
    }

    bounced(src: bounced<StoredRewardCleared>){
        let _bounceAmount: Int? = self.bouncedTokenRewards.get(src.tokenIndex);
        let bounceAmount: Int = 0;
        if (_bounceAmount != null) {
            bounceAmount = _bounceAmount!!;
        }
        self.bouncedTokenRewards.set(src.tokenIndex, bounceAmount + src.amount);
    }

    receive(msg: RemoveUserLock){
        self.removeUserLock(msg);
    }

    bounced(src: bounced<UserLockRemoved>){
        self.bouncedWithdrawAmount += src.amount;
    }

    receive(msg: UpdateExpiredLock) {
        self.updateExpiredLock(msg);
    }

    // ====== Internal Methods ====== //

    fun mintSTay(msg: MintSTay) {
        self.requireFromMaster();
        self.updateUserRewards(msg.tokenRewardPerShares, true);
        self.locks.set(self.index,
            LockedLP{amount: msg.amount, releaseTime: msg.releaseTime, isExpirationChecked: false}
        );
        self.index += 1;
        self.locked += msg.amount;
        self.forward(self.owner, emptyCell(), false, null);
    }

    fun clearStoredReward(msg: ClearUserStoredReward) {
        self.requireFromMaster();
        self.updateUserRewards(msg.tokenRewardPerShares, true);
        let userTokenReward: UserTokenReward = self.tokenRewards.get(msg.token)!!;
        let rewardAmount = userTokenReward.storedReward;
        userTokenReward.storedReward = 0;
        self.tokenRewards.set(msg.token, userTokenReward);
        self.forward(self.master,
            StoredRewardCleared{
                token: msg.token,
                tokenIndex: msg.tokenIndex,
                user: self.owner,
                amount: rewardAmount
            }.toCell(),
            true,
            null
        );
    }

    fun claimBouncedTokenReward(msg: ClaimBouncedTokenReward) {
        self.requireFromOwner();
        // TODO add gas check
        let bouncedAmount: Int = self.bouncedTokenRewards.get(msg.tokenIndex)!!;
        self.bouncedTokenRewards.set(msg.tokenIndex, 0);
        self.forward(self.master,
            StoredRewardCleared{
                token: null,
                tokenIndex: msg.tokenIndex,
                user: self.owner,
                amount: bouncedAmount
            }.toCell(),
            true,
            null
        );
    }

    fun removeUserLock(msg: RemoveUserLock) {
        self.requireFromMaster();
        self.updateUserRewards(msg.tokenRewardPerShares, true);
        let lock: LockedLP = self.locks.get(msg.lockIndex)!!;
        require(lock.releaseTime < now(), "Lock isn't expired");
        if (lock.isExpirationChecked == false) {
            self.locked -= lock.amount;
        }
        self.locks.del(msg.lockIndex);
        self.forward(self.master, UserLockRemoved{amount: lock.amount, user: self.owner}.toCell(), true, null);
    }

    fun updateExpiredLock(msg: UpdateExpiredLock) {
        self.requireFromMaster();
        self.updateUserRewards(msg.tokenRewardPerShares, true);
        let unlockAmount: Int = 0;
        let now: Int = now();
        foreach (lockIndex, lock in self.locks) {
            if (lock.releaseTime < now && lock.isExpirationChecked == false) {
                self.locked -= lock.amount;
                unlockAmount += lock.amount;
                lock.isExpirationChecked = true;
                self.locks.set(lockIndex, lock);
            }
        }
        self.forward(
            self.master, 
            ExpiredLockUpdated{amount: unlockAmount, user: self.owner, responseDestination: msg.responseDestination}.toCell(), 
            false, 
            null
        );
    }

    fun updateUserRewards(latestTokenRewardPerShares: map<Address, Int>, updateStorage: Bool): map<Address, Int> {
        let latestUserRewards: map<Address, Int> = emptyMap();
        foreach (token, latestTokenRewardPerShare in latestTokenRewardPerShares) {
            let _userTokenReward: UserTokenReward? = self.tokenRewards.get(token);
            let userTokenReward: UserTokenReward = UserTokenReward{storedReward: 0, paidRewardsPerShare: 0};
            if (_userTokenReward != null) {
                userTokenReward = _userTokenReward!!;
            }
            let actualRewardPerShare: Int = latestTokenRewardPerShare - userTokenReward.paidRewardsPerShare;
            userTokenReward.storedReward += (self.locked * actualRewardPerShare) / REWARD_PRECISION;
            userTokenReward.paidRewardsPerShare = latestTokenRewardPerShare;
            if (updateStorage) {
                self.tokenRewards.set(token, userTokenReward);
            }
            latestUserRewards.set(token, userTokenReward.storedReward);
        }
        return latestUserRewards;
    }

    fun remainingValue(value: Int, selfConsumption: Int): Int {
        let msgValue: Int = value;
        let tonBalanceBeforeMsg: Int = myBalance() - msgValue;
        let storageFee: Int = self.storageReserve - min(tonBalanceBeforeMsg, self.storageReserve);
        msgValue = msgValue - (storageFee + selfConsumption);
        return msgValue;
    }

    fun requireFromMaster() {
        require(sender() == self.master, "Not from master");
    }

    fun requireFromOwner() {
        require(sender() == self.owner, "Not from owner");
    }

    // ====== Get Methods ====== //

    get fun latestUserRewards(latestTokenRewardPerShares: map<Address, Int>): map<Address, Int> {
        return self.updateUserRewards(latestTokenRewardPerShares, false);
    }

    get fun userSTayData(): UserSTayData {
        return
            UserSTayData{
                master: self.master,
                owner: self.owner,
                locked: self.locked,
                index: self.index,
                locks: self.locks,
                tokenRewards: self.tokenRewards,
                bouncedTokenRewards: self.bouncedTokenRewards,
                bouncedWithdrawAmount: self.bouncedWithdrawAmount,
                autoRelock: self.autoRelock
            };
    }
}