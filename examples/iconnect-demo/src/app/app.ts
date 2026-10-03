import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatWidgetComponent } from '@wealthcompass/angular';
import { AuthService } from './core/auth.service';

@Component({
  imports: [RouterOutlet, ChatWidgetComponent],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  protected readonly auth = inject(AuthService);
}
