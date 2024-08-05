struct RoleData {
    members: map<Address, Bool>;
}

message GrantRole {
    role: Int;
    admin: Address;
}

message RevokeRole {
    role: Int;
    admin: Address;
}

message RenounceRole {
    role: Int;
}

trait PoolACL {
    const DEFAULT_ADMIN_ROLE: Int = 0;
    const POOL_ADMIN_ROLE: Int = 1;
    const ASSET_LISTING_ADMIN_ROLE: Int = 2;
    const RISK_ADMIN_ROLE: Int = 3;
    const EMERGENCY_ADMIN_ROLE: Int = 4;
    // ACL admins
    admins: map<Int, RoleData>;

    // ====== Received Messages ====== //
    receive(msg: GrantRole) {
        self.grantRole(msg.role, msg.admin);
    }

    receive(msg: RevokeRole) {
        self.revokeRole(msg.role, msg.admin);
    }

    receive(msg: RenounceRole) {
        self.renounceRole(msg.role);
    }

    // ====== Internal Methods ====== //
    fun _acl_initialize(admin: Address) {
        let defaultAdminMembers: map<Address, Bool> = emptyMap();
        defaultAdminMembers.set(admin, true);
        let defaultAdminRoleData: RoleData = RoleData{
            members: defaultAdminMembers
        };
        self.admins.set(self.DEFAULT_ADMIN_ROLE, defaultAdminRoleData);

        let emptyRoleData: RoleData = RoleData{
            members: emptyMap()
        };
        self.admins.set(self.POOL_ADMIN_ROLE, emptyRoleData);
        self.admins.set(self.ASSET_LISTING_ADMIN_ROLE, emptyRoleData);
        self.admins.set(self.RISK_ADMIN_ROLE, emptyRoleData);
        self.admins.set(self.EMERGENCY_ADMIN_ROLE, emptyRoleData);
    }

    fun requireDefaultAdmin() {
        require(self.hasRole(self.DEFAULT_ADMIN_ROLE, sender()), "Not DEFAULT_ADMIN_ROLE");
    }

    fun requirePoolAdmin() {
        require(self.hasRole(self.POOL_ADMIN_ROLE, sender()), "Not POOL_ADMIN_ROLE");
    }

    fun requireAssetListingAdmin() {
        require(self.hasRole(self.ASSET_LISTING_ADMIN_ROLE, sender()), "Not ASSET_LISTING_ADMIN_ROLE");
    }

    fun requireRiskAdmin() {
        require(self.hasRole(self.RISK_ADMIN_ROLE, sender()), "Not RISK_ADMIN_ROLE");
    }

    fun requireEmergencyAdmin() {
        require(self.hasRole(self.EMERGENCY_ADMIN_ROLE, sender()), "Not EMERGENCY_ADMIN_ROLE");
    }

    fun grantRole(role: Int, admin: Address) {
        self.requireDefaultAdmin();
        let roleData: RoleData = self.admins.get(role)!!;
        roleData.members.set(admin, true);
        self.admins.set(role, roleData);
    }

    fun revokeRole(role: Int, admin: Address) {
        self.requireDefaultAdmin();
        let roleData: RoleData = self.admins.get(role)!!;
        roleData.members.del(admin);
        self.admins.set(role, roleData);
    }

    fun renounceRole(role: Int) {
        let roleData: RoleData = self.admins.get(role)!!;
        roleData.members.del(sender());
        self.admins.set(role, roleData);
    }


    // ====== Get Methods ====== //
    get fun hasRole(role: Int, admin: Address): Bool {
        let roleData: RoleData? = self.admins.get(role);
        if (roleData == null) {
            return false;
        }
        return roleData!!.members.get(admin) != null;
    }

    get fun roleData(role: Int): RoleData? {
        return self.admins.get(role);
    }
}