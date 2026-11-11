import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Project } from 'ts-morph';
import { scanRoutes } from './routes';

// App kiểu NgModule như tcwealth: loadChildren trỏ tới module, route nằm trong XxxRoutingModule qua
// RouterModule.forChild, component con khai trong declarations hoặc lấy từ exports của module dùng chung
function ngModuleApp() {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true } });
  const files: Record<string, string> = {
    '/app/src/app/app-routing.module.ts': `
      import { NgModule } from '@angular/core';
      import { RouterModule, Routes } from '@angular/router';
      const routes: Routes = [
        { path: '', redirectTo: 'advance-money', pathMatch: 'full' },
        { path: 'advance-money', loadChildren: () => import('./advance-money/advance-money.module').then(m => m.AdvanceMoneyModule) },
        { path: 'legacy', loadChildren: './legacy/legacy.module#LegacyModule' },
      ];
      @NgModule({ imports: [RouterModule.forRoot(routes)], exports: [RouterModule] })
      export class AppRoutingModule {}`,
    '/app/src/app/shared/shared.module.ts': `
      import { NgModule, Component } from '@angular/core';
      @Component({ selector: 'app-amount', template: '<input tourId="amount-input">' })
      export class AmountComponent {}
      @NgModule({ declarations: [AmountComponent], exports: [AmountComponent] })
      export class SharedModule {}`,
    '/app/src/app/advance-money/advance-money-routing.module.ts': `
      import { NgModule } from '@angular/core';
      import { RouterModule, Routes } from '@angular/router';
      import { AdvanceListComponent } from './advance-list.component';
      import { AdvanceCreateComponent } from './advance-create.component';
      const routes: Routes = [
        { path: '', component: AdvanceListComponent, data: { title: 'Ứng trước tiền bán' } },
        { path: 'create', component: AdvanceCreateComponent },
      ];
      @NgModule({ imports: [RouterModule.forChild(routes)], exports: [RouterModule] })
      export class AdvanceMoneyRoutingModule {}`,
    '/app/src/app/advance-money/advance-money.module.ts': `
      import { NgModule } from '@angular/core';
      import { AdvanceMoneyRoutingModule } from './advance-money-routing.module';
      import { SharedModule } from '../shared/shared.module';
      import { AdvanceListComponent } from './advance-list.component';
      import { AdvanceCreateComponent, AdvanceFormComponent } from './advance-create.component';
      @NgModule({
        declarations: [AdvanceListComponent, AdvanceCreateComponent, AdvanceFormComponent],
        imports: [SharedModule, AdvanceMoneyRoutingModule],
      })
      export class AdvanceMoneyModule {}`,
    '/app/src/app/advance-money/advance-list.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-advance-list', template: '<h2>Danh sách</h2><button tourId="advance-new">Tạo</button>' })
      export class AdvanceListComponent {}`,
    '/app/src/app/advance-money/advance-create.component.ts': `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-advance-form', template: '<app-amount></app-amount><button tourId="advance-submit">Gửi</button>' })
      export class AdvanceFormComponent {}
      @Component({ selector: 'app-advance-create', template: '<h2>Tạo yêu cầu</h2><app-advance-form></app-advance-form>' })
      export class AdvanceCreateComponent {}`,
    '/app/src/app/legacy/legacy.module.ts': `
      import { NgModule, Component } from '@angular/core';
      import { RouterModule } from '@angular/router';
      @Component({ selector: 'app-legacy', template: '<h2>Cũ</h2>' })
      export class LegacyComponent {}
      @NgModule({ declarations: [LegacyComponent], imports: [RouterModule.forChild([{ path: '', component: LegacyComponent }])] })
      export class LegacyModule {}`,
  };
  for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
  const warnings: string[] = [];
  const { routes } = scanRoutes(project, 'src/app/app-routing.module.ts', '/app', warnings);
  return { routes, warnings };
}

test('loadChildren trỏ tới NgModule: lấy route từ RouterModule.forChild của routing module', () => {
  const { routes, warnings } = ngModuleApp();
  assert.deepEqual(routes.map((r) => r.path).sort(), ['/advance-money', '/advance-money/create', '/legacy']);
  assert.deepEqual(warnings.filter((w) => /loadChildren/.test(w)), []);
  assert.equal(routes.find((r) => r.path === '/advance-money')?.title, 'Ứng trước tiền bán');
});

test('component con khai trong declarations và exports của module dùng chung được lần theo', () => {
  const { routes } = ngModuleApp();
  const create = routes.find((r) => r.path === '/advance-money/create')!;
  const ids = create.targets.map((t) => t.tourId);
  assert.ok(ids.includes('advance-submit'), 'component con trong declarations');
  assert.ok(ids.includes('amount-input'), 'component từ exports của SharedModule');
  assert.ok(!ids.includes('advance-new'), 'không lẫn target của màn khác');
});
