-- Display-only fictional readers. Never insert these into user, answer or score tables.
CREATE TABLE game_admins(
 user_id TEXT PRIMARY KEY REFERENCES game_users(id) ON DELETE CASCADE,
 granted_at INTEGER NOT NULL
);
CREATE TABLE game_demo_leaders(
 id TEXT PRIMARY KEY, nickname TEXT NOT NULL, country TEXT NOT NULL,
 university TEXT NOT NULL, average REAL NOT NULL CHECK(average BETWEEN 0 AND 100),
 rounds INTEGER NOT NULL CHECK(rounds>0), revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-01','MolarMoon','KR','Seoul Study Circle',94.8,12);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-02','구름치아','KR','Seoul Study Circle',86.4,8);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-03','SakuraScan','JP','Tokyo Reading Circle',93.2,11);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-04','はるの歯','JP','Tokyo Reading Circle',82.5,7);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-05','牙牙星球','CN','Shanghai Reading Circle',91.7,10);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-06','MintPanda','CN','Shanghai Reading Circle',79.6,6);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-07','LunaDental','ES','Madrid Reading Circle',92.1,9);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-08','DienteAzul','ES','Madrid Reading Circle',85.3,8);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-09','SorrisoLuna','IT','Milano Reading Circle',89.8,10);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-10','EnamelVento','IT','Milano Reading Circle',81.2,5);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-11','DentDeLune','FR','Lyon Reading Circle',95.1,13);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-12','CamilleRay','FR','Lyon Reading Circle',83.7,7);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-13','PixelPremolar','US','Boston Reading Circle',90.6,11);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-14','CedarCrown','US','Boston Reading Circle',76.9,6);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-15','ThamesTooth','GB','London Reading Circle',88.4,9);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-16','MolarMuse','GB','London Reading Circle',80.3,5);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-17','ZahnFuchs','DE','Berlin Reading Circle',93.9,12);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-18','KieferKomet','DE','Berlin Reading Circle',84.1,8);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-19','SorrisoSol','BR','Recife Reading Circle',87.6,9);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-20','DenteVerde','BR','Recife Reading Circle',78.8,6);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-21','SenXanh','VN','Hanoi Reading Circle',91.3,10);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-22','RangMay','VN','Hanoi Reading Circle',82.8,7);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-23','CoralCrown','AU','Melbourne Reading Circle',89.2,8);
INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES('demo-24','WattleRay','AU','Melbourne Reading Circle',77.4,5);
