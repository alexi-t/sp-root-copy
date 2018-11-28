'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let regedit = require('regedit');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    var copier = new SPCopier();
    var copyController = new SPCopyController(copier);

    context.subscriptions.push(copyController);
    context.subscriptions.push(copyController);
}

// this method is called when your extension is deactivated
export function deactivate() {
}

class SPCopier {
    private _spTemplatePath = '';
    private _statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);

    constructor() {
        const spRegKey = 'HKLM\\SOFTWARE\\Microsoft\\Office Server';

        console.log('SPCopy try to search SP path');

        regedit.list([spRegKey], (err: any, result: any) => {
            if (result[spRegKey]) {
                var versions = result[spRegKey].keys;
                var lastest = versions.pop();

                this._statusBarItem.text = 'SP Version: ' + lastest;
                this._statusBarItem.show();

                regedit.list([spRegKey + '\\' + lastest], (err: any, result: any) => {
                    if (result[spRegKey + '\\' + lastest]) {
                        this._spTemplatePath = result[spRegKey + '\\' + lastest].values['TemplatePath'].value;
                    }
                });
            } else {
                console.log('SPCopy can not find SP template path');
            }
        });
    }


    private _searchSPDataFile(startDir: string, callback: (spDataPath: string) => void) {
        var currentDir = startDir;
        var _searchDir = (err: NodeJS.ErrnoException, files: string[]) => {
            var spDataFound: boolean = false;
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                if (file == 'SharePointProjectItem.spdata') {
                    spDataFound = true;
                    callback(path.join(currentDir, file));
                    break;
                }
            }
            if (!spDataFound) {
                currentDir = path.resolve(currentDir, '..');
                if (currentDir.length > vscode.workspace.workspaceFolders![0].uri.fsPath.length)
                    fs.readdir(currentDir, _searchDir);
            }
        }
        fs.readdir(currentDir, _searchDir);
    }

    public copyFile(sourceFilePath: string) {
        if (!this._spTemplatePath)
            return;
            
        var fileDir = path.dirname(sourceFilePath);
        this._searchSPDataFile(fileDir, (spDataPath) => {
            fs.readFile(spDataPath, (err, data) => {
                var xml2js = require('xml2js');
                var parser = new xml2js.Parser();
                parser.parseString(data, (err: any, result: any) => {
                    var workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;

                    var deployType = result.ProjectItem.ProjectItemFolder[0].$.Type;

                    var deployTargetDir = result.ProjectItem.ProjectItemFolder[0].$.Target;
                    var deploySourceDir = path.dirname(spDataPath);

                    var deployRelativePath = path.relative(deploySourceDir, sourceFilePath);

                    var deployBase =
                        deployType == 'TemplateFile' ?
                            this._spTemplatePath :
                            path.resolve(this._spTemplatePath, '..');

                    var deployTargetFile = path.join(deployBase, deployTargetDir, deployRelativePath);
                    console.log(`Copy to root {Workspace}\\${path.relative(workspaceRoot, sourceFilePath)} -> ${deployType == 'RootFile' ? '{Root}' : '{Template}'}\\${path.relative(deployBase, deployTargetFile)}`);
                    fs.copyFile(sourceFilePath, deployTargetFile, (e) => {
                        console.log('error copy ' + e.message);
                    });
                });
            });
        });
    }

    dispose() {
        this._statusBarItem.dispose();
    }
}

class SPCopyController {

    private _disposable: vscode.Disposable;
    private _copier: SPCopier;

    constructor(copier: SPCopier) {
        this._copier = copier;

        // subscribe to selection change and editor activation events
        let subscriptions: vscode.Disposable[] = [];
        vscode.workspace.onDidSaveTextDocument(this._onEvent, this, subscriptions);

        // create a combined disposable from both event subscriptions
        this._disposable = vscode.Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable.dispose();
    }

    private _onEvent(doc: vscode.TextDocument) {
        var filePath = doc.fileName;
        console.log('start copy ' + filePath);
        this._copier.copyFile(filePath);
    }
}