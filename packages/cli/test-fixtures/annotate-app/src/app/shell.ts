import { Component } from '@angular/core';
@Component({ selector: 'app-shell', imports: [], template: `<nav><a routerLink="/orders">Quay về sổ lệnh</a></nav><router-outlet />` })
export class ShellPage {}
@Component({ selector: 'app-inner', template: `<h3>Trong khung</h3>` })
export class InnerPage {}
