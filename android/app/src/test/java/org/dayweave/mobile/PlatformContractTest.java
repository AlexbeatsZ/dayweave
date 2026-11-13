package org.dayweave.mobile;

import static org.junit.Assert.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import javax.crypto.Cipher;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Holds the native implementations to tests/fixtures/platform-contract.json, as the Node tests do. */
public class PlatformContractTest {
    private static JSONObject contract() throws Exception {
        return new JSONObject(new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"), "../../tests/fixtures/platform-contract.json")), StandardCharsets.UTF_8));
    }
    private static Set<String> strings(JSONArray array) throws Exception {
        Set<String> result=new HashSet<>();for(int index=0;index<array.length();index++)result.add(array.getString(index));return result;
    }
    @Test public void syncAddressesMatchTheSharedContract() throws Exception {
        JSONArray cases=contract().getJSONArray("syncEndpoints");
        for(int index=0;index<cases.length();index++){
            JSONObject item=cases.getJSONObject(index);String input=item.getString("input");
            if(item.isNull("output")){try{SyncEndpoint.parse(input);fail(input);}catch(Exception expected){}}
            else assertEquals(input,item.getString("output"),SyncEndpoint.parse(input));
        }
    }
    @Test public void usageReplyEnvelopeOpensWithTheSharedKeyAndAad() throws Exception {
        JSONObject sample=contract().getJSONObject("usageEnvelope"),envelope=sample.getJSONObject("envelope");
        java.util.Base64.Decoder decoder=java.util.Base64.getUrlDecoder();
        String aad=UsageSync.aad(sample.getString("path"),sample.getString("clientId"));
        assertEquals(sample.getString("aad"),aad);
        byte[] plain=UsageSync.crypt(Cipher.DECRYPT_MODE,decoder.decode(sample.getString("key")),decoder.decode(envelope.getString("iv")),decoder.decode(envelope.getString("data")),aad);
        JSONObject expected=sample.getJSONObject("plaintext"),actual=new JSONObject(new String(plain,StandardCharsets.UTF_8));
        assertEquals(expected.getString("requestId"),actual.getString("requestId"));
        assertEquals(expected.getLong("cursor"),actual.getLong("cursor"));
        assertEquals(expected.getBoolean("more"),actual.getBoolean("more"));
        assertEquals(0,actual.getJSONArray("events").length());
    }
    @Test public void widgetCourseExpansionMatchesTheSharedContract() throws Exception {
        JSONObject sample=contract().getJSONObject("courses");
        List<CourseSchedule.Course> courses=new ArrayList<>();
        JSONArray rows=sample.getJSONArray("courses");
        for(int index=0;index<rows.length();index++){
            JSONObject row=rows.getJSONObject(index);JSONArray weeks=row.getJSONArray("weeks");int[] values=new int[weeks.length()];
            for(int week=0;week<values.length;week++)values[week]=weeks.getInt(week);
            courses.add(new CourseSchedule.Course(row.getString("name"),row.getString("location"),row.getString("teacher"),row.getInt("weekday"),row.getString("start"),row.getString("end"),values,strings(row.getJSONArray("excludedDates"))));
        }
        List<CourseSchedule.Event> expanded=CourseSchedule.expand(sample.getString("semesterStart"),sample.getString("timeZone"),courses,new ArrayList<>(),strings(sample.getJSONArray("holidays")),sample.getLong("now"));
        JSONArray expected=sample.getJSONArray("occurrences");
        assertEquals(expected.length(),expanded.size());
        for(int index=0;index<expected.length();index++){
            JSONObject row=expected.getJSONObject(index);
            assertEquals(row.getString("name"),expanded.get(index).name);
            assertEquals(row.getLong("start"),expanded.get(index).start);
            assertEquals(row.getLong("end"),expanded.get(index).end);
        }
    }
    @Test public void schoolBrowserMatchesTheSharedContract() throws Exception {
        JSONObject fudan=contract().getJSONObject("fudan");
        assertEquals(fudan.getString("loginUrl"),FudanBrowser.LOGIN);
        assertEquals(fudan.getString("tableUrl"),FudanBrowser.TABLE);
        for(String host:strings(fudan.getJSONArray("hosts")))assertTrue(host,FudanBrowser.official("https://"+host+"/x"));
        JSONObject errors=fudan.getJSONObject("errors");
        for(java.util.Iterator<String> keys=errors.keys();keys.hasNext();){String input=keys.next();assertEquals(input,errors.getString(input),FudanBrowser.captureError(input));}
    }
}
