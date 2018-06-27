import { observable, computed } from "mobx";
import userDb from "../db/UserDb";

class UserStore {
  @observable userId = null; //userId of the current user
  @observable usersMap = new Map(); //holds all the users' publicInfo that we've loaded
  @observable privateInfo = null; //only reads/writes by user
  @observable serverInfo = null; //only user reads, only server writes

  init() {
    _listenToCurrentUser();
  }

  /**
   * callback executed when the user is established/logs in, args: user
   * @param {function} callback
   */
  onLogin(callback) {
    _onLoginTriggers.push(callback);
  }

  /**
   * callback executed when the user logs out, args: user
   * @param {function} callback
   */
  onLogout(callback) {
    _onLogoutTriggers.push(callback);
  }

  /** @var {Object} user - current user's public info */
  @computed
  get user() {
    return this.usersMap.get(this.userId);
  }

  /**
   * @var {Object} fullUser - current user's data by privacy
   * @property {string} id - user's unique id
   * @property {Object} public - user info available to all users
   * @property {Object} private - user info available only to this user
   * @property {Object} server - readable only by this user, not writeable
   */
  @computed
  get fullUser() {
    return {
      id: this.userId,
      public: this.user,
      private: this.privateInfo,
      server: this.serverInfo
    };
  }

  /**
   * retrieves public user info if loaded. fetches the user if not already loaded.
   * @param {string} userId
   * @returns {?Object} user
   */
  getUserById(userId) {
    const user = this.usersMap.get(userId);
    if (!user) {
      _listenToPublicUserData(userId);
    }
    return user;
  }

  /**
   * logs in a user with an email and password
   * @param {Object} user
   * @param {string} user.email
   * @param {string} user.password
   * @param {function} callback called with args: (err, res)
   */
  login(user, callback) {
    userDb.login(user, callback);
  }

  /** logs out the current user */
  logout() {
    userDb.logout(this.user);
    this.userId = null;
  }

  /**
   * creates a user with an email and password
   * @param {Object} user
   * @param {string} user.email
   * @param {string} user.password
   * @param {function} callback called with args: (err, res)
   */
  createUser(user, callback) {
    if (!user || !user.email || !user.password) {
      return callback({
        message: "You must provide an email and password"
      });
    }

    userDb.createUser(user, (err, userDataByPrivacy) => {
      if (err) return callback(err);
      _saveCurrentUserLocally(userDataByPrivacy);
      callback(err, userDataByPrivacy);
    });
  }

  /**
   * search users already stored in memory by a specific field
   * @param {string} field
   * @param {string} query
   * @returns {Array.<Object>} array of users
   */
  searchFromLocalUsersByField(field, query) {
    let results = [];
    this.usersMap.entries().forEach(([uid, user]) => {
      if (
        user &&
        typeof user[field] === "string" &&
        user[field].toUpperCase().includes(query.toUpperCase())
      ) {
        results.push(user);
      }
    });
    return results;
  }

  /**
   * sends a reset email to an email address if the account exists
   * @param {string} email
   * @returns {Promise} password reset result
   */
  sendPasswordResetEmail(email) {
    return userDb.sendPasswordResetEmail(email);
  }
}

const userStore = new UserStore();
export default userStore;

//Private members. Not accessible from views.

let _onLoginTriggers = [];
let _onLogoutTriggers = [];

const _listenToCurrentUser = function() {
  userDb.listenToCurrentUser((err, userData) => {
    if (err) {
      debugger;
      return;
    } else if (!userData) {
      //user logged out
      if (userStore.userId) {
        _handleUserLogout();
      }
      userStore.userId = null;
    } else {
      //new data
      let shouldExecEstablished = !userStore.user && userData.publicInfo;
      _saveCurrentUserLocally(userData);
      if (shouldExecEstablished) {
        _handleUserEstablished({
          id: userData.publicInfo.id,
          publicInfo: userData.publicInfo
        });
      }
    }
  });
};

const _updateUser = function() {
  const user = this;
  const uid = user.id;
  delete user.save;
  delete user.id;
  delete user.displayName;
  userDb.saveToUsersCollection(uid, { publicInfo: user });
  _savePublicUserInfo(uid, user); //reapply deleted properties
};

const _handleUserLogout = function() {
  const user = userStore.fullUser;
  //module hooks
  try {
    _onLogoutTriggers.forEach(event => {
      event(user);
    });
  } catch (err) {
    debugger;
  }
};

const _handleUserEstablished = function(user) {
  //module hooks
  try {
    _onLoginTriggers.forEach(event => {
      event(user);
    });
  } catch (err) {
    console.log(err);
  }
};

const _saveCurrentUserLocally = function(userDataByPrivacy) {
  const { id, publicInfo, privateInfo, serverInfo } = userDataByPrivacy;
  if (publicInfo) {
    _savePublicUserInfo(id, publicInfo);
    if (publicInfo && publicInfo.isOnline) {
      userStore.userId = id;
    }
  }
  if (privateInfo) {
    userStore.privateInfo = privateInfo;
  }
  if (serverInfo) {
    userStore.serverInfo = serverInfo;
  }
};

const _listenToPublicUserData = function(userId) {
  userDb.listenToUser(userId, (err, user) => {
    _savePublicUserInfo(userId, user);
  });
};

const _savePublicUserInfo = function(userId, user) {
  if (!user) return;
  user.displayName = user.email;
  user.save = _updateUser;
  user.id = userId;
  userStore.usersMap.set(userId, user);
};
