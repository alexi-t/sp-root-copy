import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as util from 'util';

const readDir = util.promisify(fs.readdir);

export function searchFileAscending(startDir: string, fileFilter: (fileName: string) => boolean): Promise<string> {
  return new Promise<string>(async (r, e) => {
    const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
    let currentDir = startDir;
    while (true) {
      if (currentDir.length < workspaceRoot.length)
        break;

      const files = await readDir(currentDir);
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (fileFilter(file)) {
          r(path.join(currentDir, file));
          break;
        }
      }

      currentDir = path.resolve(currentDir, '..');
    }
  });
}

const xml2js = require('xml2js');
export function parseXML<T>(data: Buffer) {
  return new Promise<T>((r, e) => {
    var parser = new xml2js.Parser();
    parser.parseString(data, (err: any, result: any) => {
      if (err)
        e(err);
      else
        r(result as T);
    });
  });
}