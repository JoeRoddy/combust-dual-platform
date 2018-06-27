import firebase from "firebase/app";
import "firebase/database";
import "firebase/auth";

import userStore from "../stores/UserStore";

class UserDb {
  createUser(user, callback) {
    if (!user || !user.email || !user.password) {
      throw new Error(
        `UserDb.create(): requires a user object with an email && password`
      );
    }
    firebase
      .auth()
      .createUserWithEmailAndPassword(user.email, user.password)
      .then(res => {
        delete user.password;
        const userDataByPrivacy = {
          publicInfo: Object.assign(_getPublicUserObject(user.email), user),
          privateInfo: _getPrivateUserObject(),
          serverInfo: _getServerUserObject()
        };

        this.saveToUsersCollection(res.user.uid, userDataByPrivacy);
        userDataByPrivacy.id = res.user.uid;
        return callback(null, userDataByPrivacy);
      })
      .catch(error => {
        callback(error);
        console.log(error.message);
      });
  }

  /**
   * returns a promise representing the user's
   * publicInfo update, if it changed
   * @param {*} uid
   * @param {*} userDataByPrivacy
   */
  saveToUsersCollection(uid, userDataByPrivacy) {
    if (!uid) {
      return;
    }

    let firebaseUpdatePromise = null;
    ["publicInfo", "privateInfo", "serverInfo"].forEach(privacy => {
      const data = userDataByPrivacy[privacy];
      if (data) {
        let prom = firebase
          .database()
          .ref("/users/" + privacy)
          .child(uid)
          .update(data);
        firebaseUpdatePromise =
          privacy === "publicInfo" ? prom : firebaseUpdatePromise;
      }
    });
    return firebaseUpdatePromise;
  }

  listenToCurrentUser(callback) {
    const db = firebase.database();
    firebase.auth().onAuthStateChanged(userAuth => {
      if (userAuth) {
        const userRef = db.ref("users/publicInfo/" + userAuth.uid);
        userRef.once("value").then(snap => {
          const userData = snap.val();
          if (userData) {
            userRef.update({ lastOnline: new Date().getTime() });
            _applyListenersForCurrentUser(userAuth.uid, (err, data) => {
              if (err) return callback(err);
              data.id = userAuth.uid;
              callback(null, data);
            });
          } else if (
            !snap.exists() &&
            userAuth.providerData &&
            userAuth.providerData[0].providerId !== "password"
          ) {
            _createUserFromThirdPartyAuth(userAuth, callback);
          }
        });
      } else {
        callback(null, null);
      }
    });
  }

  listenToUser(userId, callback) {
    firebase
      .database()
      .ref("users/publicInfo/" + userId)
      .on("value", snapshot => {
        const friend = snapshot.val();
        if (!friend) {
          return callback(null, null);
        }
        friend.id = userId;
        callback(null, friend);
      });
  }

  login(user, callback) {
    const auth = firebase.auth();
    const db = firebase.database();
    auth.signInWithEmailAndPassword(user.email, user.password).then(
      res => {
        callback(null, res);
        const { uid } = res.user;
        db.ref("users/publicInfo")
          .child(uid)
          .update({
            isOnline: true
          });
      },
      err => {
        callback(err);
      }
    );
    _monitorOnlineStatus();
  }

  logout(user) {
    const auth = firebase.auth();
    if (!auth.currentUser) {
      return;
    }

    if (!user) {
      throw new Error("No user provided to logout");
    }
    auth.signOut();
    firebase
      .database()
      .ref("users/publicInfo")
      .child(user.id)
      .update({ isOnline: false });
  }

  /**
   * used to verify the user when making HTTP requests
   * https://firebase.google.com/docs/auth/admin/verify-id-tokens
   */
  getAuthToken() {
    return firebase.auth().currentUser.getToken(/* forceRefresh */ true);
  }

  usersLoaded = false;
  loadUserData = () => {
    this.usersLoaded = true;
    firebase
      .database()
      .ref("users/publicInfo")
      .once("value")
      .then(snap => {
        let userData = snap.val();
        userData &&
          Object.keys(userData).forEach(uid => {
            userStore.getUserById(uid);
          });
      });
  };

  searchByField(query, field) {
    if (!this.usersLoaded) {
      this.loadUserData();
    }
    if (!query) {
      return [];
    }
    const users = userStore.usersMap.values();
    let i = Array.from(users).filter(user => {
      return (
        user.id !== userStore.userId &&
        (user[field] && user[field].toUpperCase().includes(query.toUpperCase()))
      );
    });
    return i;
  }

  sendPasswordResetEmail(email) {
    return firebase.auth().sendPasswordResetEmail(email);
  }
}

const userDb = new UserDb();
export default userDb;

const _applyListenersForCurrentUser = function(uid, callback) {
  if (!uid) {
    throw new Error("no uid provided to listenToUser()");
  }

  ["publicInfo", "privateInfo", "serverInfo"].forEach(privacy => {
    firebase
      .database()
      .ref("users")
      .child(privacy)
      .child(uid)
      .on("value", snap => {
        let userData = snap.val();
        if (!userData) {
          callback("No user data found");
        } else {
          userData.id = uid;
        }
        callback(null, {
          id: uid,
          [privacy]: userData
        });
      });
  });

  _monitorOnlineStatus();
};

const _getPublicUserObject = function(email) {
  const timeNow = new Date().getTime();
  return {
    //globally readable, user-writeable
    email: email,
    createdAt: timeNow,
    lastOnline: timeNow,
    isOnline: true,
    iconUrl: _getRandomProfilePic()
  };
};

const _getPrivateUserObject = function() {
  return {
    //user-only-readable, user-writeable
    conversations: {},
    friends: {},
    notificationToken: null,
    notificationsEnabled: true
  };
};

const _getServerUserObject = function() {
  return {
    //user-only-readable, server-only writeable
    //new fields should be validated in database.rules.json
    walletBalance: 0,
    isAdmin: false
  };
};

const _monitorOnlineStatus = function() {
  const currentUser = firebase.auth().currentUser;
  if (!currentUser || !currentUser.uid) {
    return;
  }
  const uid = currentUser.uid;
  const amOnline = firebase.database().ref("/.info/connected");
  const userRef = firebase
    .database()
    .ref("/users/publicInfo/" + uid + "/isOnline");
  amOnline.on("value", snapshot => {
    if (snapshot.val()) {
      userRef.onDisconnect().set(false);
    }
  });
  userRef.on("value", snapshot => {
    window.setTimeout(() => {
      if (firebase.auth().currentUser) {
        userRef.set(true);
      }
    }, 2000);
  });
};

const _createUserFromThirdPartyAuth = function(authInfo, callback) {
  const { providerData, uid } = authInfo;
  const mainProviderInfo = providerData[0];
  const [firstName, lastName] = mainProviderInfo.displayName.split(" ");
  const timeNow = new Date().getTime();

  const publicInfo = {
    firstName,
    lastName,
    email: mainProviderInfo.email,
    phoneNumber: mainProviderInfo.phoneNumber,
    iconUrl: mainProviderInfo.photoURL,
    providerId: mainProviderInfo.providerId,
    providerUid: mainProviderInfo.uid,
    createdAt: timeNow,
    lastOnline: timeNow,
    isOnline: true
  };
  const userDataByPrivacy = {
    publicInfo,
    privateInfo: _getPrivateUserObject(),
    serverInfo: _getServerUserObject()
  };

  userDb
    .saveToUsersCollection(uid, userDataByPrivacy)
    .then(res => {
      _applyListenersForCurrentUser(uid, (err, data) => {
        if (err) return callback(err);
        data.id = uid;
        callback(null, data);
      });
    })
    .catch(err => {
      console.log("err saving user from social auth:", err);
    });
};

const _getRandomProfilePic = function() {
  const profilePics = [
    "https://firebasestorage.googleapis.com/v0/b/textable-92f65.appspot.com/o/dog1.jpeg?alt=media&token=320085e5-59a5-445e-a146-5411980e7a56",
    "https://firebasestorage.googleapis.com/v0/b/textable-92f65.appspot.com/o/dog2.jpeg?alt=media&token=54717b55-bbad-459e-8fb4-2dbf9caf76dd",
    "https://firebasestorage.googleapis.com/v0/b/textable-92f65.appspot.com/o/dog3.jpeg?alt=media&token=283db004-83d8-4857-84b4-7b0a61dc172f",
    "https://firebasestorage.googleapis.com/v0/b/textable-92f65.appspot.com/o/dog5.jpeg?alt=media&token=f3ce9b3d-34de-4124-aed2-67354220b9aa",
    "https://firebasestorage.googleapis.com/v0/b/textable-92f65.appspot.com/o/dog4.jpeg?alt=media&token=c7504834-c5e3-4081-8177-f013d8683f8d"
  ];

  return profilePics[Math.floor(Math.random() * profilePics.length)];
};
