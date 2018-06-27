const WEB_FOLDER = "web";
const MOBILE_FOLDER = "mobile";

const fs = require("fs");
const path = require("path");

let fsTimeout;
let lastFileChanged;

const WATCHED_DIRECTORIES = ["stores", "db", ".combust"];

watchDir = dir => {
  fs.watch(dir, (eventType, filename) => {
    const filePath = path.join(dir, filename);
    if (!fsTimeout || lastFileChanged !== filePath) {
      fsTimeout = setTimeout(function() {
        fsTimeout = null;
      }, 200); //200 ms for multiple events (prevents unnecessary reloads)
      handleFileEvent(eventType, filePath);
    }
    lastFileChanged = filePath;
  });
};

handleFileEvent = (eventType, filePath) => {
  switch (eventType) {
    case "change":
      return handleFileChange(filePath);
    case "rename":
      return handleFileRename(filePath);
    default:
      console.log(`unhandled watcher event ${eventType} for file: ${filePath}`);
  }
};

handleFileChange = filePath => {
  const pathSuffix = getPathSuffix(filePath);
  copyFile("./" + filePath, `./${MOBILE_FOLDER}/src/${pathSuffix}`);
  copyFile("./" + filePath, `./${WEB_FOLDER}/src/${pathSuffix}`);
};

handleFileRename = filePath => {
  fileExists(filePath, existence => {
    if (existence) {
      // new file
      handleFileChange(filePath);
    } else {
      // file deleted
      const suffix = getPathSuffix(filePath);
      const onErr = err => err && console.log(err);
      fs.unlink(`./${MOBILE_FOLDER}/src/${suffix}`, onErr);
      fs.unlink(`./${WEB_FOLDER}/src/${suffix}`, onErr);
    }
  });
};

fileExists = (filePath, callback) => {
  fs.access(filePath, fs.constants.F_OK, err => {
    return callback(err ? false : true);
  });
};

copyWatchedFoldersToInnerProjects = () => {
  WATCHED_DIRECTORIES.forEach(dir => {
    const srcPath = path.join("shared/", dir);
    copyFolder(srcPath, `./${MOBILE_FOLDER}/src/`);
    copyFolder(srcPath, `./${WEB_FOLDER}/src/`);
  });
};

copyFolder = (src, dest) => {
  copyAnyFilesWithDiff(src, dest, err => {
    err && console.log("ERR: " + err);
  });
};

copyFile = (src, dest) => {
  // need to setTimeout, otherwise file change events will fire too fast.
  // destination file will sometimes end up blank.
  setTimeout(() => {
    fs.copyFile(src, dest, err => {
      if (err) throw err;
    });
  }, 50);
};

/**
 * copies files that have a diff
 * @param {*} source
 * @param {*} destination
 */
copyAnyFilesWithDiff = (source, destination, onErr) => {
  readFiles(source, (content, fileNameWithinFolder) => {
    const pathSuffix = getPathSuffix(fileNameWithinFolder);
    copyFileIfDiff(content, path.join(destination, pathSuffix), onErr);
  });
};

copyFileIfDiff = (sourceContent, destinationPath, onErr) => {
  readFile(destinationPath, destContent => {
    if (sourceContent !== destContent) {
      fs.writeFile(destinationPath, sourceContent, err => {
        if (err && onErr) return onErr(err);
      });
    }
  });
};

readFiles = (dirname, onFileContent, onErr) => {
  fs.readdir(dirname, (err, filenames) => {
    if (err && onErr) return onErr(err);
    filenames.forEach(filename => {
      readFile(path.join(dirname, filename), onFileContent, onErr);
    });
  });
};

readFile = (filePath, onFileContent, onErr) => {
  fs.readFile(filePath, "utf-8", (err, content) => {
    if (err && onErr) return onErr(err);
    onFileContent(content, filePath);
  });
};

getPathSuffix = sharedPath => {
  const shared = "shared/";
  return sharedPath.substring(sharedPath.indexOf(shared) + shared.length);
};

console.log("Starting file watcher");

// on start, copy all folder changes in /shared
copyWatchedFoldersToInnerProjects();

// place a watcher on each directory
WATCHED_DIRECTORIES.forEach(dir => watchDir("./shared/" + dir));
