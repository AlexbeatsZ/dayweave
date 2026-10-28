package org.dayweave.mobile;

import android.content.Context;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import androidx.work.WorkManager;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.OneTimeWorkRequest;
import java.util.concurrent.TimeUnit;

public final class UsageWorker extends Worker {
    public UsageWorker(Context context,WorkerParameters parameters){super(context,parameters);}
    static void schedule(Context context) {
        WorkManager manager=WorkManager.getInstance(context);
        manager.enqueueUniquePeriodicWork("dayweave-usage",ExistingPeriodicWorkPolicy.KEEP,new PeriodicWorkRequest.Builder(UsageWorker.class,15,TimeUnit.MINUTES).build());
        manager.enqueueUniqueWork("dayweave-usage-now",ExistingWorkPolicy.KEEP,new OneTimeWorkRequest.Builder(UsageWorker.class).build());
    }
    @Override public Result doWork() {
        try {UsageCapture.collect(getApplicationContext());UsageSync.run(getApplicationContext());try(UsageDatabase database=new UsageDatabase(getApplicationContext())){database.meta("error","",database.getWritableDatabase());}return Result.success();}
        catch(Exception error){try(UsageDatabase database=new UsageDatabase(getApplicationContext())){database.meta("error",error.getMessage()==null?error.getClass().getSimpleName():error.getMessage(),database.getWritableDatabase());}return Result.retry();}
    }
}
