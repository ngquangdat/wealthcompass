import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { analyzeTemplate } from './template';

test('đọc tourId trong khối @if/@for và *ngIf', () => {
  const info = analyzeTemplate(`
    @if (ready) { <button tourId="a" tourLabel="Nút A">A</button> }
    @for (row of rows; track row) { <i tourId="row-btn" tourRole="user-only"></i> }
    <div *ngIf="x"><span [tourId]="'b'"></span></div>`);
  assert.deepEqual(info.targets.map((t) => t.tourId), ['a', 'row-btn', 'b']);
  assert.equal(info.targets[0].label, 'Nút A');
  assert.equal(info.targets[1].sensitivity, 'user-only');
});

test('thẻ component tự đóng không nuốt phần tử sau nó', () => {
  const info = analyzeTemplate(`<app-foo /><button tourId="after">x</button>`);
  assert.deepEqual(info.targets.map((t) => t.tourId), ['after']);
  assert.ok(info.tags.has('app-foo'));
});

test('tourId động ([tourId]="item.id") không được quét', () => {
  const info = analyzeTemplate(`<a [tourId]="item.id"></a>`);
  assert.deepEqual(info.targets, []);
});
